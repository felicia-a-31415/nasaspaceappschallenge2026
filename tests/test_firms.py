import re
from datetime import date
from pathlib import Path

import httpx
import pytest

from harmonize import firms
from harmonize.firms import FirmsError, fetch, wait_for_budget
from harmonize.schema import unify

FIXTURES = Path(__file__).parent / "fixtures"
MODIS = (FIXTURES / "firms_modis_sample.csv").read_text()
VIIRS = (FIXTURES / "firms_viirs_sample.csv").read_text()
MODIS_HEADER = MODIS.splitlines()[0]
AVAILABILITY = """data_id,min_date,max_date
MODIS_NRT,2026-09-01,2026-11-14
MODIS_SP,2000-11-01,2026-08-31
VIIRS_NOAA20_NRT,2026-08-01,2026-11-14
VIIRS_NOAA20_SP,2018-04-01,2026-07-31
VIIRS_SNPP_NRT,2026-08-01,2026-11-02
VIIRS_SNPP_SP,2012-01-20,2026-07-31
"""
BOX = (-80, 45, -70, 55)


class MockApi:
    """Stands in for the FIRMS server. Records every area request."""

    def __init__(self):
        self.requests, self.forced, self.failures_left = [], None, 0
        self.client = httpx.Client(transport=httpx.MockTransport(self.handle))

    def always_return(self, status, text):
        self.forced = (status, text)

    def fail_first(self, n):
        self.failures_left = n

    def handle(self, request):
        path = request.url.path
        if "data_availability" in path:
            return httpx.Response(200, text=AVAILABILITY)
        key, source, box, days, start = path.split("/api/area/csv/")[1].split("/")
        self.requests.append(type("Req", (), {"source": source, "box": box, "days": int(days), "start": start})())
        if self.forced:
            return httpx.Response(self.forced[0], text=self.forced[1])
        if self.failures_left:
            self.failures_left -= 1
            return httpx.Response(500, text="Server Error")
        body = MODIS if source.startswith("MODIS") else VIIRS
        if source.endswith("_NRT"):                       # recent sources carry no `type` column
            body = "\n".join(re.sub(r",[^,]*$", "", line) for line in body.splitlines()) + "\n"
        return httpx.Response(200, text=body)


@pytest.fixture
def mock_api():
    return MockApi()


def get(mock_api, dataset, start, end, key="k"):
    return fetch(dataset, BOX, start, end, key, client=mock_api.client, sleep=lambda s: None)


def test_fetch_normalises_viirs_columns_for_unify(mock_api):
    df = get(mock_api, "viirs_snpp", date(2020, 7, 1), date(2020, 7, 10))
    assert {"brightness", "bright_t31"} <= set(df.columns) and "bright_ti4" not in df.columns
    assert len(df) == 40 and len(unify(df, "viirs_snpp", "archive")) == len(df)
    assert set(df["satellite"]) == {"SNPP"}                        # the download files say SNPP, the API says N


def test_fetch_splits_into_five_day_requests(mock_api):
    get(mock_api, "modis", date(2005, 1, 1), date(2005, 1, 12))
    assert sorted((r.days, r.start) for r in mock_api.requests) == [(2, "2005-01-11"), (5, "2005-01-01"), (5, "2005-01-06")]
    assert {r.source for r in mock_api.requests} == {"MODIS_SP"} and mock_api.requests[0].box == "-80,45,-70,55"


def test_recent_days_come_from_the_recent_source(mock_api):
    df = get(mock_api, "modis", date(2026, 8, 30), date(2026, 9, 3))
    assert sorted((r.source, r.days, r.start) for r in mock_api.requests) == \
        [("MODIS_NRT", 3, "2026-09-01"), ("MODIS_SP", 2, "2026-08-30")]
    assert len(unify(df, "modis", "nrt")) == len(df)               # mixed with and without `type` still unifies


def test_days_before_the_sensor_existed_are_not_requested(mock_api):
    df = get(mock_api, "viirs_snpp", date(2005, 1, 1), date(2005, 12, 31))
    assert mock_api.requests == [] and len(df) == 0 and "latitude" in df.columns


def test_error_text_is_not_treated_as_no_fire(mock_api):            # Review Focus 2
    mock_api.always_return(200, "Exceeding allowed transaction limit.")
    with pytest.raises(FirmsError) as e:
        get(mock_api, "modis", date(2005, 1, 1), date(2005, 1, 5), key="SECRETKEY")
    assert "SECRETKEY" not in str(e.value) and len(mock_api.requests) == 4     # one try and three retries


def test_http_error_never_leaks_the_key(mock_api):
    mock_api.always_return(400, "Invalid MAP_KEY.")
    with pytest.raises(FirmsError) as e:
        get(mock_api, "modis", date(2005, 1, 1), date(2005, 1, 5), key="SECRETKEY")
    assert "SECRETKEY" not in str(e.value) and "Invalid MAP_KEY" in str(e.value)


def test_one_bad_reply_is_retried(mock_api):
    mock_api.fail_first(1)
    assert len(get(mock_api, "modis", date(2005, 1, 1), date(2005, 1, 5))) == 20


def test_header_only_reply_is_an_empty_frame(mock_api):
    mock_api.always_return(200, MODIS_HEADER + "\n")
    df = get(mock_api, "modis", date(2005, 1, 1), date(2005, 1, 5))
    assert len(df) == 0 and "latitude" in df.columns


def test_wait_for_budget_sleeps_until_room(monkeypatch):
    used = iter([4700, 4700, 900])
    naps = []
    monkeypatch.setattr(firms, "budget_used", lambda key, client=None: next(used))
    wait_for_budget("k", needed=730, sleep=naps.append)
    assert naps == [30, 30]


def test_load_key_prefers_environment_and_explains_when_missing(monkeypatch, tmp_path):
    monkeypatch.setenv("FIRMS_MAP_KEY", "fromenv")
    assert firms.load_key(tmp_path / ".env") == "fromenv"
    monkeypatch.delenv("FIRMS_MAP_KEY")
    (tmp_path / ".env").write_text("FIRMS_MAP_KEY=fromfile\n")
    assert firms.load_key(tmp_path / ".env") == "fromfile"
    with pytest.raises(FirmsError):
        firms.load_key(tmp_path / "nothing.env")
