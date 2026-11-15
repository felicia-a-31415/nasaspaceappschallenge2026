from datetime import date, timedelta

import pandas as pd

from server.outlook import outlook

AT = (50.05, -74.0, 100)


def _cd(days, cell=(50.0, -74.0), sensor="VIIRS"):
    return pd.DataFrame({"date": pd.to_datetime(list(days)), "cell_lat": cell[0], "cell_lon": cell[1], "sensor": sensor})


def _each_year(month_day_list, years=range(2012, 2023)):
    return [f"{y}-{md}" for y in years for md in month_day_list]


def _weather(on, rain=3.0, tmax=20.0, recent_rain=None, recent_tmax=None, recent_valid=30):
    """Daily weather from Dec 2011 to `on`; the 30 days up to `on` can be overridden."""
    out, day = [], date(2011, 12, 1)
    while day <= on:
        recent = (on - day).days < 30
        p = recent_rain if recent and recent_rain is not None else rain
        t = recent_tmax if recent and recent_tmax is not None else tmax
        if recent and (on - day).days >= recent_valid:
            p = t = None
        out.append({"date": day.isoformat(), "precip_mm": p, "temp_max_c": t, "wind_ms": 1.0, "humidity_pct": 50.0})
        day += timedelta(days=1)
    return out


def test_too_little_history_gives_no_level():
    cd = _cd(_each_year(["06-05"], years=range(2020, 2023)))
    out = outlook(cd, *AT, on=date(2023, 6, 1), weather=None)
    assert out["level"] is None and out["history"] is None and out["reasons"]
    assert out["window"] == {"from": "2023-06-02", "to": "2023-06-15"}


def test_peak_season_is_high_and_says_why():
    cd = _cd(_each_year(["06-05", "06-06", "06-07"]))
    out = outlook(cd, *AT, on=date(2023, 6, 1), weather=None)
    assert out["level"] == "high"
    assert out["history"]["years"] == 10 and out["history"]["years_with_fire"] == 10   # 2012 starts too late in the data
    assert out["weather"] is None and any("weather" in r for r in out["reasons"])


def test_a_week_that_never_burns_is_low_and_never_raised():
    cd = _cd(_each_year(["06-05"]) + [f"2023-01-{d:02d}" for d in range(1, 11)])   # a burst right now, in January
    on = date(2023, 1, 10)
    out = outlook(cd, *AT, on=on, weather=_weather(on, recent_rain=0.0, recent_tmax=30.0))
    assert out["level"] == "low" and any("not raised" in r for r in out["reasons"])


def _steady_fire():
    """Fire one day a week all year, so the window is ordinary for this place."""
    days = pd.date_range("2012-01-04", "2023-06-01", freq="7D")
    return _cd(d.strftime("%Y-%m-%d") for d in days)


def test_ordinary_window_is_usual():
    on = date(2023, 6, 1)
    out = outlook(_steady_fire(), *AT, on=on, weather=_weather(on))
    assert out["level"] == "usual" and out["weather"]["usual_rain_mm"] == 90.0


def test_dry_month_raises_one_step():
    on = date(2023, 6, 1)
    out = outlook(_steady_fire(), *AT, on=on, weather=_weather(on, recent_rain=1.0))
    assert out["level"] == "high" and out["weather"]["rain_mm"] == 30.0
    assert any("rain" in r for r in out["reasons"])


def test_wet_month_lowers_one_step():
    on = date(2023, 6, 1)
    assert outlook(_steady_fire(), *AT, on=on, weather=_weather(on, recent_rain=6.0))["level"] == "low"


def test_busy_last_two_weeks_raises_one_step():
    on = date(2023, 6, 1)
    burst = _cd([f"2023-05-{d:02d}" for d in range(20, 32)], cell=(50.1, -74.0))
    out = outlook(pd.concat([_steady_fire(), burst]), *AT, on=on, weather=_weather(on))
    assert out["level"] == "high" and out["recent"]["activity"] > 2 * out["recent"]["usual"]


def test_dry_and_busy_still_only_one_step():
    on = date(2023, 6, 1)
    burst = _cd([f"2023-05-{d:02d}" for d in range(20, 32)], cell=(50.1, -74.0))
    out = outlook(pd.concat([_steady_fire(), burst]), *AT, on=on, weather=_weather(on, recent_rain=1.0))
    assert out["level"] == "high"


def test_patchy_weather_is_left_out():
    on = date(2023, 6, 1)
    out = outlook(_steady_fire(), *AT, on=on, weather=_weather(on, recent_rain=1.0, recent_valid=10))
    assert out["weather"] is None and out["level"] == "usual"


def test_older_camera_is_not_used_for_history():
    cd = pd.concat([_cd(_each_year(["06-05"], years=range(2001, 2012)), sensor="MODIS"),
                    _cd(_each_year(["06-05"], years=range(2012, 2023)), sensor="MODIS")])
    out = outlook(cd, *AT, on=date(2023, 6, 1), weather=None)
    assert out["history"]["years_with_fire"] == 0 and out["level"] == "low"
