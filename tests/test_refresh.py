from datetime import date, timedelta

import pandas as pd
import pytest

from harmonize.firms import FILE_COLUMNS
from harmonize.refresh import REFRESH_SPAN_DAYS, refresh
from harmonize.run import data_through
from harmonize.schema import load_all

TODAY = date(2026, 11, 14)


class FakeFetch:
    """One hotspot in Quebec and one in Maine for every day asked for."""

    def __init__(self):
        self.calls = []

    def calls_for(self, dataset):
        return [c for c in self.calls if c.dataset == dataset]

    def __call__(self, dataset, box, start, end, key, **kwargs):
        self.calls.append(type("Call", (), {"dataset": dataset, "box": box, "start": start, "end": end})())
        days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
        rows = [dict(latitude=lat, longitude=lon, brightness=330.0, scan=1.0, track=1.0, acq_date=d.isoformat(),
                     acq_time="636", satellite="Terra", instrument="MODIS", confidence="80", version="6.1NRT",
                     bright_t31=290.0, frp=12.0, daynight="D")
                for d in days for lat, lon in ((50.0, -74.0), (45.2, -69.0))]
        return pd.DataFrame(rows, columns=FILE_COLUMNS)


@pytest.fixture
def fake_fetch():
    return FakeFetch()


@pytest.fixture
def tmp_region(tmp_path):
    """A region called "tiny" with MODIS data ending 2026-11-10 and no VIIRS folders."""
    folder = tmp_path / "data" / "tiny" / "modis"
    folder.mkdir(parents=True)
    row = dict(latitude=50.0, longitude=-74.0, brightness=310.0, scan=1.0, track=1.0, acq_time="1700",
               satellite="Terra", instrument="MODIS", confidence="60", version="6.03", bright_t31=280.0,
               frp=10.0, daynight="D", type=0)
    pd.DataFrame([dict(row, acq_date="2026-07-01"), dict(row, acq_date="2026-08-20")]).to_csv(folder / "fire_archive_x.csv", index=False)
    pd.DataFrame([dict(row, acq_date="2026-11-10")]).drop(columns="type").to_csv(folder / "fire_nrt_x.csv", index=False)
    return tmp_path


def test_refresh_adds_only_new_days_inside_quebec(tmp_region, fake_fetch):
    added = refresh("tiny", root=tmp_region, fetch=fake_fetch, today=TODAY)
    call = fake_fetch.calls_for("modis")[0]
    assert (call.start, call.end) == (date(2026, 11, 11), TODAY - timedelta(days=1))   # today is not over yet
    assert added == {"modis": 3}                                  # 3 days, Quebec rows only; no VIIRS folders, no VIIRS fetch
    files = list((tmp_region / "data/tiny/modis").glob("fire_nrt_api_*.csv"))
    assert len(files) == 1 and set(pd.read_csv(files[0])["latitude"]) == {50.0}
    assert len(load_all(tmp_region, "tiny")) == 3 + 3            # the pipeline's loader picks the new file up
    assert data_through(tmp_region, "tiny", "2026-11-12") == "2026-11-13"


def test_refresh_twice_adds_nothing(tmp_region, fake_fetch):
    refresh("tiny", root=tmp_region, fetch=fake_fetch, today=TODAY)
    before = sorted(p.name for p in (tmp_region / "data/tiny/modis").iterdir())
    assert sum(refresh("tiny", root=tmp_region, fetch=fake_fetch, today=TODAY).values()) == 0
    assert sorted(p.name for p in (tmp_region / "data/tiny/modis").iterdir()) == before
    assert len(fake_fetch.calls) == 1


def test_refresh_never_edits_existing_files(tmp_region, fake_fetch):
    originals = {p: p.read_bytes() for p in (tmp_region / "data/tiny/modis").iterdir()}
    refresh("tiny", root=tmp_region, fetch=fake_fetch, today=TODAY)
    assert all(p.read_bytes() == content for p, content in originals.items())


def test_a_quiet_week_still_counts_as_up_to_date(tmp_region):
    quiet = lambda dataset, box, start, end, key, **kw: pd.DataFrame(columns=FILE_COLUMNS)
    assert refresh("tiny", root=tmp_region, fetch=quiet, today=TODAY) == {"modis": 0}
    assert not list((tmp_region / "data/tiny/modis").glob("fire_nrt_api_*.csv"))
    assert data_through(tmp_region, "tiny", "2026-11-10") == "2026-11-13"


def test_a_long_gap_is_fetched_in_pieces_that_fit_the_budget(tmp_region, fake_fetch):
    waits = []
    later = TODAY + timedelta(days=2000)
    refresh("tiny", root=tmp_region, fetch=fake_fetch, today=later,
            wait_for_budget=lambda key, needed: waits.append(needed))
    calls = fake_fetch.calls_for("modis")
    assert len(calls) > 1 and len(waits) == len(calls)
    assert calls[0].start == date(2026, 11, 11) and calls[-1].end == later - timedelta(days=1)
    assert all(b.start == a.end + timedelta(days=1) for a, b in zip(calls, calls[1:]))        # no gaps, no overlaps
    assert all(need <= 2 * REFRESH_SPAN_DAYS for need in waits)
