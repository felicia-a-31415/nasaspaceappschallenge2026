from datetime import date

import httpx
import pytest

from server.weather import WeatherError, daily

REPLY = {"properties": {"parameter": {
    "PRECTOTCORR": {"20230601": 0.0, "20230602": 3.26},
    "T2M_MAX": {"20230601": 31.24, "20230602": -999.0},
    "WS10M": {"20230601": 4.1, "20230602": 2.0},
    "WD10M": {"20230601": 225.0, "20230602": 90.0},
    "RH2M": {"20230601": 28.0, "20230602": 60.5}}}}


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_daily_rows_and_missing_values():
    seen = {}
    def handler(request):
        seen.update(request.url.params)
        return httpx.Response(200, json=REPLY)
    days = daily(49.9, -74.4, date(2023, 6, 1), date(2023, 6, 2), client=_client(handler))
    assert seen["start"] == "20230601" and seen["end"] == "20230602" and "T2M_MAX" in seen["parameters"]
    assert days[0] == {"date": "2023-06-01", "precip_mm": 0.0, "temp_max_c": 31.2, "wind_ms": 4.1, "wind_from_deg": 225.0,
                       "humidity_pct": 28.0}
    assert days[1]["temp_max_c"] is None and days[1]["precip_mm"] == 3.3


@pytest.mark.parametrize("reply", [httpx.Response(500, text="oops"), httpx.Response(200, text="<html>"),
                                   httpx.Response(200, json={"messages": ["bad request"]})])
def test_bad_replies_raise(reply):
    with pytest.raises(WeatherError):
        daily(49.9, -74.4, date(2023, 6, 1), date(2023, 6, 2), client=_client(lambda request: reply))
