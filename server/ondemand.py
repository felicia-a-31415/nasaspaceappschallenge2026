"""Places outside the preloaded region, fetched from NASA FIRMS on demand.

A click outside Quebec asks for a box of about 10 by 10 degrees around it.
One worker fetches one box at a time, one calendar year per step, newest
first, so the calendar fills in from the top. Finished boxes are kept in
`<cache>/places/<id>/` and never fetched again.

Saved layout per place:
    meta.json                         box, finished steps, status
    cell_days.parquet                 burning squares so far (date, cell_lat, cell_lon, sensor)
    hotspots/<dataset>_<year>.parquet hotspots in the shared layout, plus likely_static
"""
import json
import logging
import math
import os
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

from harmonize import firms
from harmonize.grid import cell_days, viirs_reference
from harmonize.query import RADII_KM, SWITCH
from harmonize.schema import clean, flag_static, unify
from server.store import Table

log = logging.getLogger("fire.ondemand")

HALF_DEG = 5                       # half the box's side
MAX_LAT = 75                       # no fetch offered beyond this latitude
EDGE_LAT = 80                      # the box never passes this latitude
VIIRS_FIRST = date(2012, 1, 20)    # Suomi NPP's first day
MODIS_FIRST = date(2000, 11, 1)
MODIS_LAST = date(2012, 1, 31)     # MODIS is used up to the month before VIIRS takes over
RETRY_AFTER = 120                  # seconds before a failed place may be tried again
STEP_RETRY_WAIT = 60
AVAIL_TTL = 3600
CD_COLUMNS = ["date", "cell_lat", "cell_lon", "sensor"]
NO_ANSWER = "NASA's fire data service did not answer. Try again in a few minutes."
NO_KEY = "The server has no NASA FIRMS key, so it cannot fetch new places."


def _half_lon(centre_lat):
    """Half-width in longitude, widened far north and south so the largest circle still fits."""
    reach_deg = max(RADII_KM) / 111.0
    widest = math.cos(math.radians(min(abs(centre_lat) + reach_deg + 0.5, 89)))
    return max(HALF_DEG, math.ceil(0.5 + reach_deg / widest))


def box_for(lat, lon):
    """The box (west, south, east, north) fetched for a click, or None too close to a pole."""
    if abs(lat) > MAX_LAT:
        return None
    centre_lat = max(-EDGE_LAT + HALF_DEG, min(EDGE_LAT - HALF_DEG, round(lat)))
    half = _half_lon(centre_lat)
    centre_lon = max(-180 + half, min(180 - half, round(lon)))
    return (float(centre_lon - half), float(centre_lat - HALF_DEG),
            float(centre_lon + half), float(centre_lat + HALF_DEG))


def _write_atomic(path, write):
    """Write through a temporary file and rename, so readers never see a half-written file."""
    path = Path(path)
    tmp = path.with_name(f".{path.name}.{threading.get_ident()}.tmp")
    write(tmp)
    os.replace(tmp, path)


def _to_parquet(df, path):
    _write_atomic(path, lambda tmp: df.to_parquet(tmp, index=False))


def _circle_fits(box, lat, lon, radius_km):
    west, south, east, north = box
    reach = radius_km / 111.0
    top = min(abs(lat) + reach, 89)
    reach_lon = reach / math.cos(math.radians(top))
    return south <= lat - reach and lat + reach <= north and west <= lon - reach_lon and lon + reach_lon <= east


@dataclass(frozen=True)
class Step:
    dataset: str
    year: int
    start: date
    end: date

    @property
    def key(self):
        return f"{self.dataset}_{self.year}"


def plan_steps(today, avail):
    """Every fetch for one place, in order: VIIRS newest year first, then MODIS back to 2000.

    NOAA-20 is asked only for the days after Suomi NPP's last day.
    """
    snpp_last = max(avail[s][1] for s in firms.SOURCES["viirs_snpp"] if s in avail)
    steps = []
    for year in range(today.year, VIIRS_FIRST.year - 1, -1):
        first, last = max(date(year, 1, 1), VIIRS_FIRST), min(date(year, 12, 31), today)
        steps.append(Step("viirs_snpp", year, first, last))
        if snpp_last < last:
            steps.append(Step("viirs_noaa20", year, max(first, snpp_last + timedelta(days=1)), last))
    for year in range(MODIS_LAST.year - 1, MODIS_FIRST.year - 1, -1):
        last = MODIS_LAST if year == MODIS_LAST.year - 1 else date(year, 12, 31)
        steps.append(Step("modis", year, max(date(year, 1, 1), MODIS_FIRST), last))
    return steps


def _years_done(plan, done):
    """Calendar years on the calendar so far. The short NOAA-20 top-up does not count as a year."""
    return sum(step.key in done for step in plan if step.dataset != "viirs_noaa20")


def _data_start(plan, done):
    """First month the fetched data can answer for."""
    finished = [s for s in plan if s.key in done]
    if not finished:
        return None
    earliest = min(finished, key=lambda s: s.start)
    month = pd.Period(earliest.start, "M")
    return month if earliest.dataset == "modis" else max(month, SWITCH)


@dataclass
class PlaceState:
    id: str
    box: tuple
    status: str = "queued"             # queued, fetching, fetched, failed
    steps_done: list = field(default_factory=list)
    years_done: int = 0
    years_total: int = 0
    queue_position: int = 0
    error: str | None = None
    failed_at: float = 0.0
    data_start: str | None = None      # YYYY-MM
    data_through: str | None = None    # YYYY-MM-DD
    requested_at: float = 0.0

    def progress(self):
        return {"years_done": self.years_done, "years_total": self.years_total,
                "queue_position": self.queue_position}


class Places:
    """The saved and in-progress boxes, and the single worker that fills them."""

    def __init__(self, cache_dir, model, fetch=firms.fetch, key=None, curve_source="quebec",
                 load_key=firms.load_key, availability=firms.availability,
                 wait_for_budget=firms.wait_for_budget, today=date.today):
        self.dir = Path(cache_dir) / "places"
        self.model, self.curve_source = model, curve_source
        self.fetch, self.key, self.load_key = fetch, key, load_key
        self.availability, self.wait_for_budget, self.today = availability, wait_for_budget, today
        self.places, self.queue = {}, deque()
        self.lock = threading.RLock()
        self._cd = {}
        self._avail = (0.0, None)
        self._thread, self._stop = None, threading.Event()
        self._load_saved()

    # ---- finding and queueing -------------------------------------------------

    def find(self, lat, lon, radius_km):
        """A saved or in-progress place whose box holds the whole circle.

        When several do, the one with the most data wins: fetched first, then
        the most years done, and failed places last.
        """
        rank = {"fetched": 0, "fetching": 1, "queued": 1, "failed": 2}
        with self.lock:
            fits = [s for s in self.places.values() if _circle_fits(s.box, lat, lon, radius_km)]
            return min(fits, key=lambda s: (rank.get(s.status, 1), -s.years_done), default=None)

    def request(self, lat, lon, radius_km):
        """The place for this circle: an existing one, or a new one put in the queue."""
        with self.lock:
            state = self.find(lat, lon, radius_km)
            if state is None:
                box = box_for(lat, lon)
                if box is None:
                    raise ValueError("no fetch is offered this close to a pole")
                place_id = f"{box[0]:g}_{box[1]:g}"
                state = self.places.get(place_id)
                if state is None:
                    state = PlaceState(place_id, box, years_total=self._years_total(), requested_at=time.time())
                    self.places[place_id] = state
                    self._enqueue(state)
            if state.status == "failed" and time.time() - state.failed_at >= RETRY_AFTER:
                state.error = None
                self._enqueue(state)
            return state

    def current(self):
        """The place at the head of the queue, or None."""
        with self.lock:
            return self.places[self.queue[0]] if self.queue else None

    def table(self, state):
        """What has been fetched so far for a place, or None if nothing has."""
        with self.lock:
            if not state.data_start:
                return None
            through = state.data_through
            return Table(cd=self._load_cd(state.id), model=self.model,
                         data_start=pd.Period(state.data_start, "M"), data_end=pd.Period(through, "M"),
                         data_through=through, curve_source=self.curve_source,
                         hotspots_path=self._folder(state.id) / "hotspots")

    # ---- the worker ------------------------------------------------------------

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._work, name="fire-fetch", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def _work(self):
        while not self._stop.is_set():
            try:
                busy = self.run_one_step(retry_sleep=self._stop.wait)
            except Exception:                                   # never let the worker die
                log.exception("fetch worker hit an unexpected error")
                busy = False
            if not busy:
                self._stop.wait(1)

    def run_one_step(self, retry_sleep=time.sleep):
        """Fetch one year for the place at the head of the queue. False when the queue is empty."""
        with self.lock:
            state = self.current()
            if state is None:
                return False
            state.status = "fetching"
        try:
            key = self.key or self.load_key()
            avail = self._availability(key)
            plan = plan_steps(self.today(), avail)
            step = next((s for s in plan if s.key not in state.steps_done), None)
            if step is not None:
                try:
                    self._do_step(state, step, key, avail)
                except Exception as error:
                    log.warning("step %s for %s failed (%s); one retry", step.key, state.id, type(error).__name__)
                    retry_sleep(STEP_RETRY_WAIT)
                    self._do_step(state, step, key, avail)
                with self.lock:
                    state.steps_done.append(step.key)
                    state.years_done = _years_done(plan, state.steps_done)
                    state.years_total = len({s.year for s in plan})
                    state.data_start = str(_data_start(plan, state.steps_done))
                    state.data_through = state.data_through or self.today().isoformat()
            if all(s.key in state.steps_done for s in plan):
                self._finish(state)
            self._save(state)
        except Exception as error:
            if not isinstance(error, firms.FirmsError):
                log.exception("fetching %s failed", state.id)
            with self.lock:
                state.status, state.failed_at = "failed", time.time()
                state.error = NO_KEY if isinstance(error, firms.MissingKey) else NO_ANSWER
                self._dequeue(state)
                self._save(state)
        return True

    def _do_step(self, state, step, key, avail):
        self.wait_for_budget(key, firms.cost(step.dataset, step.start, step.end, avail))
        raw = self.fetch(step.dataset, state.box, step.start, step.end, key, avail=avail)
        folder = self._folder(state.id)
        (folder / "hotspots").mkdir(parents=True, exist_ok=True)
        if len(raw):
            hotspots = flag_static(unify(raw, step.dataset, "api"))
            _to_parquet(hotspots, folder / "hotspots" / f"{step.key}.parquet")
            part = cell_days(viirs_reference(clean(hotspots)))
        else:
            part = pd.DataFrame(columns=CD_COLUMNS)
        with self.lock:
            cd = pd.concat([self._load_cd(state.id), part], ignore_index=True) if len(part) else self._load_cd(state.id)
            self._store_cd(state.id, cd)

    def _finish(self, state):
        """With the whole history in, redo the cleaning once.

        Industrial heat sources are recognised by their labels in the standard
        data. Recent data has no labels, so a year cleaned on its own keeps them.
        """
        files = sorted((self._folder(state.id) / "hotspots").glob("*.parquet"))
        if files:
            parts = [pd.read_parquet(f).assign(_file=f.name) for f in files]
            everything = flag_static(pd.concat(parts, ignore_index=True).drop(columns="likely_static"))
            for name, rows in everything.groupby("_file"):
                _to_parquet(rows.drop(columns="_file"), self._folder(state.id) / "hotspots" / name)
            cd = cell_days(viirs_reference(clean(everything.drop(columns="_file"))))
        else:
            cd = pd.DataFrame(columns=CD_COLUMNS)
        with self.lock:
            self._store_cd(state.id, cd)
            state.status = "fetched"
            self._dequeue(state)

    # ---- bookkeeping -----------------------------------------------------------

    def _years_total(self):
        return self.today().year - MODIS_FIRST.year + 1

    def _availability(self, key):
        at, avail = self._avail
        if avail is None or time.time() - at > AVAIL_TTL:
            avail = self.availability(key)
            self._avail = (time.time(), avail)
        return avail

    def _enqueue(self, state):
        state.status = "queued"
        if state.id not in self.queue:
            self.queue.append(state.id)
        self._number_queue()

    def _dequeue(self, state):
        if state.id in self.queue:
            self.queue.remove(state.id)
        state.queue_position = 0
        self._number_queue()

    def _number_queue(self):
        for position, place_id in enumerate(self.queue):
            self.places[place_id].queue_position = position

    def _folder(self, place_id):
        return self.dir / place_id

    def _empty_cd(self):
        return pd.DataFrame({"date": pd.Series(dtype="datetime64[ns]"), "cell_lat": pd.Series(dtype=float),
                             "cell_lon": pd.Series(dtype=float), "sensor": pd.Series(dtype=object)})

    def _load_cd(self, place_id):
        if place_id not in self._cd:
            path = self._folder(place_id) / "cell_days.parquet"
            self._cd[place_id] = pd.read_parquet(path) if path.exists() else self._empty_cd()
        return self._cd[place_id]

    def _store_cd(self, place_id, cd):
        cd = cd.astype({"sensor": object}).drop_duplicates().reset_index(drop=True)
        cd["date"] = pd.to_datetime(cd["date"])
        self._cd[place_id] = cd
        folder = self._folder(place_id)
        folder.mkdir(parents=True, exist_ok=True)
        _to_parquet(cd, folder / "cell_days.parquet")

    def _save(self, state):
        folder = self._folder(state.id)
        folder.mkdir(parents=True, exist_ok=True)
        with self.lock:
            meta = {k: getattr(state, k) for k in ("id", "box", "status", "steps_done", "years_done", "years_total",
                                                   "error", "data_start", "data_through", "requested_at")}
        _write_atomic(folder / "meta.json", lambda tmp: tmp.write_text(json.dumps(meta, indent=2)))

    def _load_saved(self):
        """Read saved places; anything that was waiting or mid-fetch goes back in the queue."""
        states = []
        for path in self.dir.glob("*/meta.json"):
            try:
                meta = json.loads(path.read_text())
                states.append(PlaceState(**{**meta, "box": tuple(meta["box"])}))
            except (ValueError, TypeError, KeyError):
                log.warning("ignoring unreadable %s", path)
        for state in sorted(states, key=lambda s: s.requested_at):
            self.places[state.id] = state
            if state.status in ("queued", "fetching"):
                self._enqueue(state)
            elif state.status == "failed":
                state.failed_at = 0.0          # a restart is reason enough to allow another try
