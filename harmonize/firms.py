"""Client for NASA's FIRMS area API: hotspots for a box and a date range.

Returns tables in the same column layout as the FIRMS download files, so
`schema.unify` accepts them. Differences between the API and the download
files, found by comparing real replies on 14 November 2026:

- VIIRS brightness columns are `bright_ti4` and `bright_ti5` in the API,
  `brightness` and `bright_t31` in the files.
- Suomi NPP is labelled satellite "N", instrument "VIIRS" in the API, and
  "SNPP", "SNPP" in the files.
- `acq_time` has no leading zeros in the API ("636" for 06:36). `unify` pads it.
- Recent (NRT) sources have no `type` column, as in the files.

Errors arrive as short text with HTTP 400 ("Invalid MAP_KEY.") and possibly
with HTTP 200, so a reply only counts as data if it starts with the header.

Budget: 5,000 units per 10 minutes per key, about 2 units per day requested.
"""
import io
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import httpx
import pandas as pd

BASE = "https://firms.modaps.eosdis.nasa.gov"
SOURCES = {
    "modis": ("MODIS_SP", "MODIS_NRT"),
    "viirs_snpp": ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"),
    "viirs_noaa20": ("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"),
}
RENAME = {"bright_ti4": "brightness", "bright_ti5": "bright_t31"}
FILE_COLUMNS = ["latitude", "longitude", "brightness", "scan", "track", "acq_date", "acq_time",
                "satellite", "instrument", "confidence", "version", "bright_t31", "frp", "daynight"]
MAX_DAYS = 5
UNITS_PER_DAY = 2
RETRY_WAITS = (2, 5, 10)
BUDGET_LIMIT = 4800
TEXT = {"confidence": str, "acq_time": str, "version": str}


class FirmsError(Exception):
    """The FIRMS service could not be used. The message never contains the key."""


def load_key(env_path=".env"):
    """The key from the environment, else from a .env file."""
    key = os.environ.get("FIRMS_MAP_KEY")
    path = Path(env_path)
    if not key and path.exists():
        for line in path.read_text().splitlines():
            if line.strip().startswith("FIRMS_MAP_KEY"):
                key = line.split("=", 1)[1].strip().strip("\"'")
    if not key:
        raise FirmsError("No FIRMS key found. Put FIRMS_MAP_KEY=... in the .env file.")
    return key


def _get(url, key, client, sleep, is_valid):
    """GET with retries. Raises FirmsError, with the key scrubbed, after the last try."""
    problem = "no reply"
    for wait in (*RETRY_WAITS, None):
        try:
            reply = client.get(url, timeout=120)
            text = reply.text
            if reply.status_code == 200 and is_valid(text):
                return text
            problem = f"HTTP {reply.status_code}: {text.strip()[:120]}"
        except httpx.HTTPError as error:
            problem = f"{type(error).__name__}: {error}"
        if wait is not None:
            sleep(wait)
    raise FirmsError(f"FIRMS did not return data ({problem})".replace(key, "<key>"))


def _own_client(client):
    return client or httpx.Client(limits=httpx.Limits(max_connections=40))


def budget_used(key, client=None):
    """Units spent in the current 10-minute window."""
    client = _own_client(client)
    reply = client.get(f"{BASE}/mapserver/mapkey_status/", params={"MAP_KEY": key}, timeout=60)
    try:
        return int(reply.json()["current_transactions"])
    except (ValueError, KeyError) as error:
        raise FirmsError("FIRMS did not report the key's status.") from error


def wait_for_budget(key, needed, limit=BUDGET_LIMIT, sleep=time.sleep, client=None):
    """Return once `needed` more units fit under the limit, checking every 30 seconds."""
    while budget_used(key, client=client) + needed > limit:
        sleep(30)


def availability(key, client=None, sleep=time.sleep):
    """First and last date each source covers: {"MODIS_SP": (date, date), ...}."""
    text = _get(f"{BASE}/api/data_availability/csv/{key}/ALL", key, _own_client(client), sleep,
                lambda t: t.lstrip().startswith("data_id"))
    table = pd.read_csv(io.StringIO(text))
    return {row.data_id: (date.fromisoformat(row.min_date), date.fromisoformat(row.max_date))
            for row in table.itertuples()}


def _chunks(source, first, last):
    """(source, days, start) for each request of at most five days."""
    out, day = [], first
    while day <= last:
        days = min(MAX_DAYS, (last - day).days + 1)
        out.append((source, days, day))
        day += timedelta(days=days)
    return out


def plan_requests(dataset, start, end, avail):
    """Which source serves which days: the standard one where it reaches, the recent one after."""
    standard, recent = SOURCES[dataset]
    out = []
    if standard in avail:
        first, last = max(start, avail[standard][0]), min(end, avail[standard][1])
        out += _chunks(standard, first, last)
        start = max(start, avail[standard][1] + timedelta(days=1))
    if recent in avail:
        out += _chunks(recent, max(start, avail[recent][0]), min(end, avail[recent][1]))
    return out


def cost(dataset, start, end, avail):
    """Estimated budget units for a fetch."""
    return UNITS_PER_DAY * sum(days for _, days, _ in plan_requests(dataset, start, end, avail))


def _parse(text, dataset):
    df = pd.read_csv(io.StringIO(text), dtype=TEXT)
    df.columns = [c.strip() for c in df.columns]
    df = df.rename(columns=RENAME)
    if dataset == "viirs_snpp":
        df["satellite"], df["instrument"] = "SNPP", "SNPP"
    return df


def fetch(dataset, box, start, end, key, workers=20, client=None, sleep=time.sleep, avail=None):
    """All hotspots for one dataset in a box (west, south, east, north), start to end inclusive."""
    client = _own_client(client)
    avail = avail or availability(key, client, sleep)
    area = ",".join(f"{v:g}" for v in box)

    def one(request):
        source, days, day = request
        url = f"{BASE}/api/area/csv/{key}/{source}/{area}/{days}/{day.isoformat()}"
        return _parse(_get(url, key, client, sleep, lambda t: t.lstrip().startswith("latitude,")), dataset)

    requests = plan_requests(dataset, start, end, avail)
    with ThreadPoolExecutor(max(1, workers)) as pool:
        parts = [p for p in pool.map(one, requests)]
    filled = [p for p in parts if len(p)]
    if not filled:
        return pd.DataFrame(columns=FILE_COLUMNS)
    return pd.concat(filled, ignore_index=True)
