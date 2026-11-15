"""Weather forecasts from Open-Meteo (https://open-meteo.com). No key needed.

One model throughout, Japan's global model (JMA GSM, about 0.5 degrees), because it is
the one whose old forecasts are archived far enough back (2018) to test the spread model
on 2023 with what was really forecast at the time.

- `latest`: the current forecast, for days that have not happened yet (or only just).
- `archived`: the forecast issued N days before each day, for N = 1..days (Previous Runs API).

Both return daily rows like NASA POWER's (server/weather.py), in UTC days:
wind_ms (mean speed), wind_from_deg (direction of the mean wind), temp_max_c,
humidity_pct (mean), precip_mm (total).
"""
import time
from datetime import date, timedelta

import httpx
import numpy as np
import pandas as pd

MODEL = "jma_gsm"
LATEST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"
HOURLY = {"wind_speed_10m": "speed", "wind_direction_10m": "dir", "temperature_2m": "temp",
          "relative_humidity_2m": "rh", "precipitation": "rain"}
SOURCE = "Open-Meteo, JMA GSM forecast"


class ForecastError(Exception):
    """Open-Meteo could not be used."""


def _get(client, url, params, tries=3):
    for attempt in range(tries):
        try:
            reply = client.get(url, params=params, timeout=60)
            if reply.status_code == 429 and attempt < tries - 1:     # over the free limit for this minute
                time.sleep(20 * (attempt + 1))
                continue
            reply.raise_for_status()
            return reply.json()["hourly"]
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as error:
            if attempt == tries - 1:
                raise ForecastError(type(error).__name__) from None
            time.sleep(2)
    raise ForecastError("too many requests")


def daily(hourly, suffix=""):
    """Hourly Open-Meteo values -> POWER-like daily rows."""
    f = pd.DataFrame({"time": pd.to_datetime(hourly["time"])})
    for name, short in HOURLY.items():
        f[short] = pd.to_numeric(pd.Series(hourly.get(name + suffix, [None] * len(f))), errors="coerce")
    rad = np.radians(f["dir"])
    f["u"], f["v"] = -f["speed"] * np.sin(rad), -f["speed"] * np.cos(rad)     # where the air goes
    g = f.groupby(f["time"].dt.normalize())
    out = pd.DataFrame({"wind_ms": g["speed"].mean(), "u": g["u"].mean(), "v": g["v"].mean(),
                        "temp_max_c": g["temp"].max(), "humidity_pct": g["rh"].mean(),
                        "precip_mm": g["rain"].sum(min_count=12), "hours": g["speed"].count()})
    out = out[out["hours"] >= 12]
    out["wind_from_deg"] = (np.degrees(np.arctan2(-out["u"], -out["v"])) + 360) % 360
    return [{"date": d.strftime("%Y-%m-%d"),
             **{c: None if pd.isna(r[c]) else round(float(r[c]), 1)
                for c in ("precip_mm", "temp_max_c", "wind_ms", "wind_from_deg", "humidity_pct")}}
            for d, r in out.iterrows()]


def latest(lat, lon, first: date, last: date, client=None):
    """The current forecast for days first..last (up to about 10 days ahead, and up to 90 days back)."""
    params = {"latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}", "hourly": ",".join(HOURLY), "models": MODEL,
              "wind_speed_unit": "ms", "timezone": "GMT",
              "start_date": first.isoformat(), "end_date": last.isoformat()}
    return daily(_get(client or httpx, LATEST_URL, params))


def archived(lat, lon, first: date, last: date, leads, client=None):
    """{lead: daily rows} with, for each day first..last, the forecast made `lead` days before."""
    names = [f"{name}_previous_day{k}" for k in leads for name in HOURLY]
    params = {"latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}", "hourly": ",".join(names), "models": MODEL,
              "wind_speed_unit": "ms", "timezone": "GMT",
              "start_date": first.isoformat(), "end_date": last.isoformat()}
    hourly = _get(client or httpx, ARCHIVE_URL, params)
    return {k: daily(hourly, f"_previous_day{k}") for k in leads}


def as_issued(lat, lon, issue: date, days: int, today: date | None = None, client=None):
    """What was forecast on `issue` for the `days` after it: {lead: rows}, or one row list for all leads.

    For a recent `issue` the archive does not have the days ahead yet, so the current
    forecast is used instead (it is at most a day or two newer).
    """
    today = today or date.today()
    first, last = issue + timedelta(days=1), issue + timedelta(days=days)
    if issue >= today - timedelta(days=2):
        return latest(lat, lon, first, last, client)
    return archived(lat, lon, first, last, range(1, days + 1), client)
