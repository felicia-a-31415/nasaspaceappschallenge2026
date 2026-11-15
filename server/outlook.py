"""Risk outlook: how fire-prone the next two weeks usually are at a place, nudged by right now.

Not a forecast of where fire will spread. The base level comes from past
years (newer camera only, 2012 on, because the correction between cameras
holds only for a month or longer). Recent fire and recent weather (NASA
POWER) can move it one step. Every step has a plain reason.
"""
from datetime import date, timedelta

import numpy as np
import pandas as pd

from harmonize.query import cells_in_circle

LABEL = "Outlook from past seasons and recent weather"
LEVELS = ("low", "usual", "high")
WINDOW_DAYS = 14
RECENT_DAYS = 14
WEATHER_DAYS = 30
MIN_WEATHER_DAYS = 20
MIN_YEARS = 5
VIIRS_FROM = date(2012, 2, 1)
SEASON_HIGH = 2.0           # window usually brings at least twice an average two weeks
RECENT_HIGH = 2.0
RECENT_MIN = 3
DRY, WET = 0.5, 1.5         # share of usual 30-day rain
HOT_C = 2.0


def _same_day(on, years_back):
    return (pd.Timestamp(on) - pd.DateOffset(years=years_back)).date()


def _total(daily, first, last):
    return float(daily[(daily.index >= pd.Timestamp(first)) & (daily.index <= pd.Timestamp(last))].sum())


def _history(daily, on, data_start):
    """Per past year: activity in the window, in the recent days, and over a whole year from the window."""
    earliest = max(VIIRS_FROM, data_start)
    rows, k = [], 1
    while True:
        day = _same_day(on, k)
        if day - timedelta(days=RECENT_DAYS - 1) < earliest:
            break
        start = day + timedelta(days=1)
        rows.append({"year": day.year,
                     "window": _total(daily, start, day + timedelta(days=WINDOW_DAYS)),
                     "recent": _total(daily, day - timedelta(days=RECENT_DAYS - 1), day),
                     "year_total": _total(daily, start, start + timedelta(days=364))})
        k += 1
    return pd.DataFrame(rows, columns=["year", "window", "recent", "year_total"])


def _weather_stretch(by_day, end):
    """(rain over 30 days scaled for missing days, mean maximum temperature) or None if too patchy."""
    days = [by_day.get(end - timedelta(days=i)) for i in range(WEATHER_DAYS)]
    rain = [d["precip_mm"] for d in days if d and d.get("precip_mm") is not None]
    heat = [d["temp_max_c"] for d in days if d and d.get("temp_max_c") is not None]
    if len(rain) < MIN_WEATHER_DAYS or len(heat) < MIN_WEATHER_DAYS:
        return None
    return float(np.mean(rain)) * WEATHER_DAYS, float(np.mean(heat))


def _weather(weather, on, years):
    if not weather:
        return None
    by_day = {date.fromisoformat(d["date"]): d for d in weather}
    now = _weather_stretch(by_day, on)
    past = [s for s in (_weather_stretch(by_day, _same_day(on, k)) for k in range(1, years + 1)) if s]
    if now is None or len(past) < MIN_YEARS:
        return None
    return {"rain_mm": round(now[0], 1), "usual_rain_mm": round(float(np.median([p[0] for p in past])), 1),
            "temp_max_c": round(now[1], 1), "usual_temp_max_c": round(float(np.median([p[1] for p in past])), 1)}


def _years_phrase(n, total):
    return f"{n} of the last {total} years" if n else f"none of the last {total} years"


WEATHER_START = VIIRS_FROM - timedelta(days=WEATHER_DAYS + RECENT_DAYS)   # covers the earliest past year used


def empty(on):
    """An outlook with no level, for when there is nothing to answer from."""
    window = {"from": (on + timedelta(days=1)).isoformat(), "to": (on + timedelta(days=WINDOW_DAYS)).isoformat()}
    return {"label": LABEL, "as_of": on.isoformat(), "window": window,
            "level": None, "reasons": [], "history": None, "recent": None, "weather": None}


def outlook(cd, lat, lon, radius_km, on: date, weather=None, data_start: date | None = None):
    """The outlook for a circle and the 14 days after `on`.

    `cd` is a burning-squares table (date, cell_lat, cell_lon, sensor);
    `weather` is NASA POWER daily rows covering the past years up to `on`, or None.
    """
    base = empty(on)
    if data_start is None:
        data_start = cd["date"].min().date().replace(day=1) if len(cd) else on
    rows = cells_in_circle(cd, lat, lon, radius_km)
    daily = rows[rows["sensor"] == "VIIRS"].groupby("date").size()
    hist = _history(daily, on, data_start)
    if len(hist) < MIN_YEARS:
        base["reasons"] = ["There are not enough past years of fire records here to give an outlook."]
        return base

    years, with_fire = len(hist), int((hist["window"] > 0).sum())
    median_window = float(hist["window"].median())
    # share of all past fire that fell in these two weeks, against an even spread over the year
    avg_two_weeks = float(hist["year_total"].sum()) * WINDOW_DAYS / 365
    factor = float(hist["window"].sum()) / avg_two_weeks if avg_two_weeks > 0 else None
    recent_now = _total(daily, on - timedelta(days=RECENT_DAYS - 1), on)
    recent_usual = float(hist["recent"].median())
    reasons = []

    if with_fire < years / 3:
        level = 0
        reasons.append(f"There was fire here in these two weeks in {_years_phrase(with_fire, years)}.")
    elif factor is not None and factor >= SEASON_HIGH:
        level = 2
        reasons.append(f"These two weeks are usually a busy time for fire here: about {factor:.1f} times "
                       f"an average two weeks, with fire in {with_fire} of the last {years} years.")
    else:
        level = 1
        amount = "" if factor is None else f", about {factor:.1f} times an average two weeks"
        reasons.append(f"There was fire here in these two weeks in {with_fire} of the last {years} years{amount}.")

    steps = 0
    if recent_now >= max(RECENT_HIGH * recent_usual, RECENT_MIN):
        steps += 1
        reasons.append(f"The last two weeks had more fire than usual: {recent_now:.0f} against a usual {recent_usual:.0f}.")

    w = _weather(weather, on, years)
    if w is None:
        reasons.append("Recent weather was not available, so it is not counted.")
    else:
        share = w["rain_mm"] / w["usual_rain_mm"] if w["usual_rain_mm"] > 0 else None
        hot = w["temp_max_c"] - w["usual_temp_max_c"] >= HOT_C
        rain_words = f"{w['rain_mm']:.0f} mm of rain in the last 30 days"
        if share is not None and (share < DRY or (share < 1 and hot)):
            steps += 1
            heat = f", and days {w['temp_max_c'] - w['usual_temp_max_c']:.1f} °C warmer than usual" if hot else ""
            reasons.append(f"It has been dry: {rain_words}, about {share * 100:.0f}% of usual{heat}.")
        elif share is not None and share > WET:
            steps -= 1
            reasons.append(f"It has been wet: {rain_words}, about {share * 100:.0f}% of usual, which lowers the risk.")

    steps = max(-1, min(1, steps))
    if steps > 0 and with_fire == 0:
        reasons.append("It is not raised, because no past year had fire here in these two weeks.")
        steps = 0
    level = max(0, min(2, level + steps))

    base.update(level=LEVELS[level], reasons=reasons, weather=w,
                history={"years": years, "years_with_fire": with_fire, "median_activity": round(median_window, 1),
                         "season_factor": None if factor is None else round(factor, 2)},
                recent={"activity": round(recent_now, 1), "usual": round(recent_usual, 1)})
    return base
