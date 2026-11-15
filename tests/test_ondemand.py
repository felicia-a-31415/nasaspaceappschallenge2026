from datetime import date

import pandas as pd
import pytest

from harmonize.firms import FILE_COLUMNS, FirmsError, MissingKey
from server.ondemand import Places, PlaceState, box_for, plan_steps

MODEL = {"a": 1.0, "b": 1.0, "sigma": 0.5}
TODAY = date(2026, 11, 14)
AVAIL = {"MODIS_SP": (date(2000, 11, 1), date(2026, 8, 31)), "MODIS_NRT": (date(2026, 9, 1), TODAY),
         "VIIRS_SNPP_SP": (date(2012, 1, 20), date(2026, 7, 31)), "VIIRS_SNPP_NRT": (date(2026, 8, 1), date(2026, 11, 2)),
         "VIIRS_NOAA20_SP": (date(2018, 4, 1), date(2026, 7, 31)), "VIIRS_NOAA20_NRT": (date(2026, 8, 1), TODAY)}
SATELLITE = {"modis": "Terra", "viirs_snpp": "SNPP", "viirs_noaa20": "N20"}


class FakeFetch:
    """Stands in for firms.fetch: one hotspot at the box centre on the first day asked for."""

    def __init__(self):
        self.calls, self.error, self.static = [], None, False

    def raise_always(self, error):
        self.error = error

    def __call__(self, dataset, box, start, end, key, **kwargs):
        self.calls.append(type("Call", (), {"dataset": dataset, "box": box, "start": start, "end": end})())
        if self.error:
            raise self.error
        west, south, east, north = box
        viirs = dataset != "modis"
        row = dict(latitude=(south + north) / 2 + 0.01, longitude=(west + east) / 2 + 0.01, brightness=330.0,
                   scan=0.4, track=0.4, acq_date=start.isoformat(), acq_time="1830", satellite=SATELLITE[dataset],
                   instrument="VIIRS" if viirs else "MODIS", confidence="n" if viirs else "80", version="2",
                   bright_t31=290.0, frp=12.0, daynight="D", type=0)
        rows = [row]
        if self.static:                                   # a smelter: labelled type 2 in standard data, unlabelled in recent data
            recent = start.year == TODAY.year
            rows += [dict(row, latitude=row["latitude"] + 1, acq_time=f"18{i}0", type=None if recent else 2)
                     for i in range(3)]
        return pd.DataFrame(rows, columns=FILE_COLUMNS + ["type"])


def make_places(tmp_path, fetch):
    return Places(tmp_path / "cache", MODEL, fetch=fetch, key="k", availability=lambda key: AVAIL,
                  wait_for_budget=lambda key, needed: None, today=lambda: TODAY)


@pytest.fixture
def fake_fetch():
    return FakeFetch()


@pytest.fixture
def places(tmp_path, fake_fetch):
    return make_places(tmp_path, fake_fetch)


def test_box_is_ten_degrees_and_stays_on_the_map():                 # Review Focus 3
    assert box_for(38.5, -121.5) == (-127.0, 33.0, -117.0, 43.0)
    w, s, e, n = box_for(-17.0, 179.5)
    assert e <= 180 and e - w == 10
    w, s, e, n = box_for(74.0, 20.0)
    assert n <= 80 and n - s == 10
    assert box_for(82.0, 20.0) is None and box_for(-76.0, 20.0) is None


def test_box_far_north_is_wide_enough_for_the_biggest_circle():
    w, s, e, n = box_for(70.0, 20.0)
    assert e - w > 10                                               # degrees of longitude are short up there


def test_plan_is_newest_first_then_the_older_satellite():
    steps = plan_steps(TODAY, AVAIL)
    assert [(s.dataset, s.year) for s in steps[:3]] == [("viirs_snpp", 2026), ("viirs_noaa20", 2026), ("viirs_snpp", 2025)]
    assert (steps[1].start, steps[1].end) == (date(2026, 11, 3), TODAY)     # NOAA-20 only after Suomi NPP stopped
    modis = [s for s in steps if s.dataset == "modis"]
    assert [s.year for s in modis] == list(range(2011, 1999, -1))
    assert modis[0].end == date(2012, 1, 31)                                # January 2012 still needs MODIS
    assert modis[-1].start == date(2000, 11, 1) and steps[-1] is modis[-1]
    assert sum(s.dataset == "viirs_snpp" for s in steps) == 15


def test_same_place_twice_is_one_fetch(places):                     # Review Focus 4
    a = places.request(38.5, -121.5, 100)
    b = places.request(38.6, -121.4, 50)
    assert a.id == b.id and len(places.queue) == 1


def test_second_place_waits_its_turn(places):
    assert places.request(38.5, -121.5, 100).queue_position == 0
    assert places.request(-33.9, 151.2, 100).queue_position == 1


def test_nothing_fetched_yet_has_no_table(places):
    s = places.request(38.5, -121.5, 100)
    assert places.table(s) is None and s.status == "queued" and s.years_total == 27


def test_newest_year_first_and_visible_after_one_step(places, fake_fetch):
    s = places.request(38.5, -121.5, 100)
    assert places.run_one_step()
    assert fake_fetch.calls[0].dataset == "viirs_snpp" and fake_fetch.calls[0].start.year == TODAY.year
    table = places.table(s)
    assert table.cd["date"].dt.year.max() == TODAY.year and s.years_done == 1 and s.status == "fetching"
    assert table.curve_source == "quebec" and table.data_start == pd.Period("2026-01") and table.data_end == pd.Period("2026-11")
    assert table.data_through == "2026-11-14"


def test_whole_history_then_fetched(places, fake_fetch):
    s = places.request(38.5, -121.5, 100)
    while places.run_one_step():
        pass
    assert s.status == "fetched" and s.years_done == s.years_total == 27 and not places.queue
    table = places.table(s)
    assert table.data_start == pd.Period("2000-11") and set(table.cd["sensor"]) == {"MODIS", "VIIRS"}
    assert len(fake_fetch.calls) == 28                              # 15 Suomi NPP years, 1 NOAA-20 tail, 12 MODIS years
    assert places.request(38.5, -121.5, 100).status == "fetched" and not places.queue   # answered from the saved box


def test_industrial_heat_is_dropped_once_the_history_is_in(places, fake_fetch):
    fake_fetch.static = True
    s = places.request(38.5, -121.5, 100)
    places.run_one_step()
    this_year = lambda: set(places.table(s).cd[lambda cd: cd["date"].dt.year == TODAY.year]["cell_lat"])
    assert this_year() == {38.0, 39.0}                              # recent data is unlabelled: the smelter still counts
    while places.run_one_step():
        pass
    assert this_year() == {38.0}                                    # older years labelled it, so it is dropped everywhere
    assert set(places.table(s).cd["cell_lat"]) == {38.0}


def test_resumes_after_restart(tmp_path, fake_fetch):
    p = make_places(tmp_path, fake_fetch)
    p.request(38.5, -121.5, 100)
    p.run_one_step()
    p2 = make_places(tmp_path, fake_fetch)
    assert len(p2.queue) == 1                                       # re-queued on start-up
    p2.run_one_step()
    p2.run_one_step()
    assert [c.dataset for c in fake_fetch.calls] == ["viirs_snpp", "viirs_noaa20", "viirs_snpp"]
    assert fake_fetch.calls[2].start.year == TODAY.year - 1         # did not redo the first year
    assert p2.table(p2.request(38.5, -121.5, 100)).cd["date"].dt.year.min() == TODAY.year - 1


def test_failure_is_reported_and_does_not_block_the_queue(places, fake_fetch):   # Review Focus 2
    fake_fetch.raise_always(FirmsError("x"))
    a = places.request(38.5, -121.5, 100)
    places.request(-33.9, 151.2, 100)
    naps = []
    places.run_one_step(retry_sleep=naps.append)
    assert naps == [60] and len(fake_fetch.calls) == 2              # one retry, a minute later
    assert a.status == "failed" and "did not answer" in a.error and places.current().id != a.id


def test_failed_place_is_retried_only_after_a_pause(places, fake_fetch):
    fake_fetch.raise_always(FirmsError("x"))
    a = places.request(38.5, -121.5, 100)
    places.run_one_step(retry_sleep=lambda s: None)
    assert places.request(38.5, -121.5, 100).status == "failed" and not places.queue    # the page asking again does not hammer NASA
    fake_fetch.error = None
    a.failed_at -= 1000
    assert places.request(38.5, -121.5, 100).status == "queued" and len(places.queue) == 1
    places.run_one_step()
    assert a.years_done == 1 and a.error is None


def test_missing_key_says_so(tmp_path, fake_fetch):
    def no_key():
        raise MissingKey("No FIRMS key found.")
    p = Places(tmp_path / "cache", MODEL, fetch=fake_fetch, key=None, load_key=no_key, availability=lambda key: AVAIL,
               wait_for_budget=lambda key, needed: None, today=lambda: TODAY)
    s = p.request(38.5, -121.5, 100)
    p.run_one_step(retry_sleep=lambda s: None)
    assert s.status == "failed" and "key" in s.error and not fake_fetch.calls


def test_find_prefers_the_place_with_data(places):
    failed = PlaceState("a", (-127.0, 33.0, -117.0, 43.0), status="failed")
    fetched = PlaceState("b", (-126.0, 34.0, -116.0, 44.0), status="fetched", years_done=26)
    fetching = PlaceState("c", (-125.0, 34.0, -115.0, 44.0), status="fetching", years_done=3)
    places.places.update({"a": failed, "c": fetching, "b": fetched})
    assert places.find(38.5, -121.0, 100) is fetched
    del places.places["b"]
    assert places.find(38.5, -121.0, 100) is fetching


def test_no_temporary_files_are_left_behind(places, tmp_path):
    places.request(38.5, -121.5, 100)
    places.run_one_step()
    assert not [f for f in (tmp_path / "cache").rglob("*") if f.name.endswith(".tmp")]
