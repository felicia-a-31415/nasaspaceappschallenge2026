"""Daily weather at a point from NASA POWER (https://power.larc.nasa.gov). No key needed."""
from datetime import date

import httpx

URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
FIELDS = {"PRECTOTCORR": "precip_mm", "T2M_MAX": "temp_max_c", "WS10M": "wind_ms", "WD10M": "wind_from_deg",
          "RH2M": "humidity_pct"}
MISSING = -900          # POWER marks missing readings with -999


class WeatherError(Exception):
    """NASA POWER could not be used."""


def daily(lat, lon, start: date, end: date, client=None):
    """[{date, precip_mm, temp_max_c, wind_ms, wind_from_deg, humidity_pct}] for each day; a value is None when NASA has none."""
    client = client or httpx
    params = {"parameters": ",".join(FIELDS), "community": "AG", "latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}",
              "start": start.strftime("%Y%m%d"), "end": end.strftime("%Y%m%d"), "format": "JSON"}
    try:
        reply = client.get(URL, params=params, timeout=60)
        reply.raise_for_status()
        series = reply.json()["properties"]["parameter"]
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as error:
        raise WeatherError(type(error).__name__) from None
    days = sorted(set().union(*(series.get(name, {}) for name in FIELDS)))
    out = []
    for day in days:
        row = {"date": f"{day[:4]}-{day[4:6]}-{day[6:]}"}
        for name, label in FIELDS.items():
            value = series.get(name, {}).get(day)
            row[label] = None if value is None or value < MISSING else round(float(value), 1)
        out.append(row)
    return out
