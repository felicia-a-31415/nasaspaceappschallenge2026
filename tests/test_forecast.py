from datetime import date

import httpx
import pytest

from server import forecast


def hourly(days, suffix="", speed=4.0, frm=270.0, rain=0.5):
    times = [f"{d}T{h:02d}:00" for d in days for h in range(24)]
    n = len(times)
    return {"time": times, f"wind_speed_10m{suffix}": [speed] * n, f"wind_direction_10m{suffix}": [frm] * n,
            f"temperature_2m{suffix}": [10.0 + (i % 24) for i in range(n)],
            f"relative_humidity_2m{suffix}": [50.0] * n, f"precipitation{suffix}": [rain] * n}


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_daily_rows_like_power():
    rows = forecast.daily(hourly(["2023-06-03"]))
    assert rows == [{"date": "2023-06-03", "precip_mm": 12.0, "temp_max_c": 33.0, "wind_ms": 4.0,
                     "wind_from_deg": 270.0, "humidity_pct": 50.0}]


def test_wind_direction_is_the_mean_wind_not_the_mean_angle():
    h = hourly(["2023-06-03"])
    h["wind_direction_10m"] = [350.0] * 12 + [10.0] * 12           # around north: the plain average would say south
    assert forecast.daily(h)[0]["wind_from_deg"] in (0.0, 360.0)


def test_days_with_too_few_hours_are_dropped():
    h = hourly(["2023-06-03"])
    h["wind_speed_10m"] = [None] * 13 + [3.0] * 11
    assert forecast.daily(h) == []


def test_archived_asks_for_each_lead_and_splits_them():
    seen = {}
    def handler(request):
        seen.update(request.url.params)
        body = {}
        for k in (1, 2):
            body.update(hourly(["2023-06-03", "2023-06-04"], f"_previous_day{k}", speed=float(k)))
        return httpx.Response(200, json={"hourly": body})
    got = forecast.archived(49.5, -76.875, date(2023, 6, 3), date(2023, 6, 4), (1, 2), client=_client(handler))
    assert "wind_speed_10m_previous_day2" in seen["hourly"] and seen["models"] == "jma_gsm"
    assert got[1][0]["wind_ms"] == 1.0 and got[2][1]["wind_ms"] == 2.0


def test_as_issued_uses_the_archive_for_old_days_and_the_live_forecast_for_recent_ones():
    urls = []
    def handler(request):
        urls.append(str(request.url))
        if "previous-runs" in str(request.url):
            body = {}
            for k in (1, 2):
                body.update(hourly(["2023-06-03", "2023-06-04"], f"_previous_day{k}"))
            return httpx.Response(200, json={"hourly": body})
        return httpx.Response(200, json={"hourly": hourly(["2026-11-15", "2026-11-16"])})
    c = _client(handler)
    old = forecast.as_issued(49.5, -76.875, date(2023, 6, 2), 2, today=date(2026, 11, 15), client=c)
    new = forecast.as_issued(49.5, -76.875, date(2026, 11, 14), 2, today=date(2026, 11, 15), client=c)
    assert isinstance(old, dict) and set(old) == {1, 2} and "previous-runs" in urls[0]
    assert isinstance(new, list) and "api.open-meteo.com" in urls[1]


@pytest.mark.parametrize("reply", [httpx.Response(500, text="oops"), httpx.Response(200, text="<html>"),
                                   httpx.Response(200, json={"error": True, "reason": "bad"})])
def test_bad_replies_raise(reply, monkeypatch):
    monkeypatch.setattr(forecast.time, "sleep", lambda s: None)
    with pytest.raises(forecast.ForecastError):
        forecast.latest(49.5, -76.875, date(2026, 11, 15), date(2026, 11, 16), client=_client(lambda r: reply))
