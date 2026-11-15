"""Fire spread forecast: which nearby squares are likely to burn in the next few days.

Experimental. A gradient-boosted tree model (scikit-learn) learned from past
Quebec fires. For each square of about 2 km near a fire that is burning on the
day asked, it gives the chance that VIIRS sees fire there within 1, 2, 3, ...
days. It is trained only on what was known on that day: where fire was today
and on the two days before, how close and how strong it was, whether the square
already burned this season, and NASA POWER weather (wind direction and speed,
heat, humidity, rain) at the fire.

What it cannot know: tomorrow's weather (it uses today's), firefighting,
roads and lakes, or fuel type. VIIRS misses fires under thick cloud or smoke,
so a "miss" in the record is not always a miss on the ground.
"""
import warnings
from datetime import date, timedelta

import numpy as np
import pandas as pd
from scipy.signal import fftconvolve
from scipy.spatial import cKDTree

DLAT, DLON = 0.02, 0.03          # one square: about 2.2 km north-south, 2 km east-west at 50 degrees north
REACH_KM = 30.0                  # squares further than this from today's fire are not scored
HORIZONS = (1, 2, 3, 5, 7)       # days ahead the model was trained on
MAX_DAYS = 7
FIRST_DAY = date(2012, 1, 20)    # first full day of VIIRS
LOOKBACK_DAYS = 60               # "already burned this season" looks this far back
EARTH_KM = 6371.0
TILE_LAT, TILE_LON = 0.5, 0.625  # NASA POWER's weather grid
NEAR_RADII_KM = (3, 5, 10, 20)
FEATURES = ["horizon", "d_now", "d_prev", "d_prev2", "approach", "n_3", "n_5", "n_10", "n_20",
            "frp_10", "growth_20", "self_now", "self_prev", "burned_season", "days_since",
            "wind_ms", "downwind", "crosswind", "temp_max_c", "humidity_pct", "precip_mm", "rain_3d",
            "doy", "lat"]
AHEAD = ["ahead_wind_ms", "ahead_downwind", "ahead_crosswind", "ahead_temp_max", "ahead_humidity", "ahead_rain"]
FORECAST_FEATURES = FEATURES + AHEAD   # the forecast model also sees the weather expected over the coming days
FAR_KM = 50.0                    # stands in for "no fire that day"
SPREAD_LABEL = "Experimental spread forecast"
WARN_P = 0.10                    # a square is in the warning zone at a 1 in 10 chance or more; on 2023, held out,
                                 # that zone was about the closest 2% of the area and caught about 40% of next-day burns


# ----- squares -------------------------------------------------------------------------------

def cell_index(lat, lon):
    i = np.floor(np.round(np.asarray(lat, float) / DLAT, 6)).astype(np.int64)
    j = np.floor(np.round(np.asarray(lon, float) / DLON, 6)).astype(np.int64)
    return i, j


def code(i, j):
    return i * 1_000_000 + (j + 500_000)


def decode(c):
    return c // 1_000_000, c % 1_000_000 - 500_000


def centre(i, j):
    return (np.asarray(i) + 0.5) * DLAT, (np.asarray(j) + 0.5) * DLON


def xyz(lat, lon):
    """Points on a sphere in km, so straight-line distances are close to ground distances here."""
    p, l = np.radians(lat), np.radians(lon)
    return np.column_stack([EARTH_KM * np.cos(p) * np.cos(l), EARTH_KM * np.cos(p) * np.sin(l), EARTH_KM * np.sin(p)])


def burning_cells(fires):
    """One row per square and day with VIIRS fire: date, code, n (detections), frp (sum)."""
    if not len(fires):
        return pd.DataFrame({"date": pd.Series(dtype="datetime64[ns]"), "code": pd.Series(dtype=np.int64),
                             "n": pd.Series(dtype=np.int64), "frp": pd.Series(dtype=float)})
    i, j = cell_index(fires["latitude"].to_numpy(), fires["longitude"].to_numpy())
    rows = pd.DataFrame({"date": pd.to_datetime(fires["acq_date"]).dt.normalize().to_numpy(),
                         "code": code(i, j), "frp": fires["frp"].fillna(0).to_numpy(float)})
    out = rows.groupby(["date", "code"]).agg(n=("frp", "size"), frp=("frp", "sum")).reset_index()
    return out


class Days:
    """Burning squares looked up by day."""

    def __init__(self, cells):
        self.by_day = {d: g for d, g in cells.groupby("date")}
        self.empty = cells.iloc[:0]

    def on(self, day):
        return self.by_day.get(pd.Timestamp(day), self.empty)

    def codes(self, day):
        return self.on(day)["code"].to_numpy()

    def codes_between(self, first, last):
        """Codes of squares burning on any day from `first` to `last`, both included."""
        parts = [self.codes(first + timedelta(days=k)) for k in range((last - first).days + 1)]
        parts = [p for p in parts if len(p)]
        return np.unique(np.concatenate(parts)) if parts else np.array([], dtype=np.int64)

    def last_seen(self, codes, before, days):
        """Days since each square last burned, looking back `days` before `before` (exclusive). NaN if never."""
        out = np.full(len(codes), np.nan)
        for k in range(1, days + 1):
            hit = np.isin(codes, self.codes(before - timedelta(days=k))) & np.isnan(out)
            out[hit] = k
        return out


# ----- weather -------------------------------------------------------------------------------

def tile_of(lat, lon):
    """The NASA POWER grid point a place falls on: (lat, lon) of the grid node."""
    ti = np.round(np.asarray(lat, float) / TILE_LAT)
    tj = np.round((np.asarray(lon, float) + 180) / TILE_LON)
    return np.round(ti * TILE_LAT, 4), np.round(tj * TILE_LON - 180, 4)


def tile_key(tlat, tlon):
    return np.round(np.asarray(tlat) * 1000).astype(np.int64) * 1_000_000 + np.round(np.asarray(tlon) * 1000).astype(np.int64)


WEATHER_COLS = ["wind_ms", "wind_from_deg", "temp_max_c", "humidity_pct", "precip_mm"]


def weather_frame(rows_by_tile):
    """{(tlat, tlon): [POWER daily rows]} -> a frame indexed by (tile key, date)."""
    parts = []
    for (tlat, tlon), rows in rows_by_tile.items():
        if not rows:
            continue
        f = pd.DataFrame(rows)
        f["date"] = pd.to_datetime(f["date"])
        f["tile"] = int(tile_key(tlat, tlon))
        parts.append(f)
    if not parts:
        return pd.DataFrame(columns=["tile", "date", *WEATHER_COLS, "rain_3d"]).set_index(["tile", "date"])
    w = pd.concat(parts, ignore_index=True)
    for c in WEATHER_COLS:
        if c not in w:
            w[c] = np.nan
    w = w[["tile", "date", *WEATHER_COLS]].astype({c: float for c in WEATHER_COLS}).sort_values(["tile", "date"])
    w["rain_3d"] = w.groupby("tile")["precip_mm"].transform(lambda s: s.rolling(3, min_periods=2).sum())
    return w.set_index(["tile", "date"])


def weather_at(w, tiles, day, fallback_days=3):
    """Weather on `day` for each tile key; a missing day falls back to the latest of the days before."""
    out = pd.DataFrame(np.nan, index=range(len(tiles)), columns=[*WEATHER_COLS, "rain_3d"])
    if w is None or not len(w):
        return out
    todo = np.ones(len(tiles), bool)
    for k in range(fallback_days + 1):
        if not todo.any():
            break
        idx = pd.MultiIndex.from_arrays([tiles[todo], np.repeat(pd.Timestamp(day) - pd.Timedelta(days=k), todo.sum())])
        got = w.reindex(idx)
        ok = got["wind_ms"].notna().to_numpy()
        where = np.flatnonzero(todo)[ok]
        out.iloc[where] = got.to_numpy()[ok]
        todo[where] = False
    return out


# ----- features ------------------------------------------------------------------------------

def _offsets(reach_km, lat):
    di = int(np.ceil(reach_km / (DLAT * 111.0)))
    dj = int(np.ceil(reach_km / (DLON * 111.0 * np.cos(np.radians(lat)))))
    return np.array([(a, b) for a in range(-di, di + 1) for b in range(-dj, dj + 1)], dtype=np.int64)


def candidates(active_codes, reach_km=REACH_KM):
    """Squares within reach of any square burning today (today's squares included)."""
    i, j = decode(active_codes)
    off = _offsets(reach_km, float(np.max(np.abs(centre(i, j)[0]))))
    ci = (i[:, None] + off[None, :, 0]).ravel()
    cj = (j[:, None] + off[None, :, 1]).ravel()
    out = np.unique(code(ci, cj))
    oi, oj = decode(out)
    la, lo = centre(oi, oj)
    ai, aj = centre(i, j)
    d, _ = cKDTree(xyz(ai, aj)).query(xyz(la, lo), distance_upper_bound=reach_km)
    return out[np.isfinite(d)]


def _nearest(tree_cells, pts):
    """(distance km, index) to the nearest square of a day's fire, FAR_KM when there is none."""
    if tree_cells is None:
        return np.full(len(pts), FAR_KM), np.zeros(len(pts), int)
    d, k = tree_cells.query(pts, distance_upper_bound=FAR_KM)
    k = np.where(np.isfinite(d), k, 0)
    return np.minimum(d, FAR_KM), k


def _tree(df):
    if not len(df):
        return None, None, None
    la, lo = centre(*decode(df["code"].to_numpy()))
    pts = xyz(la, lo)
    return cKDTree(pts), la, lo


def _disk(r_km, lat):
    dy, dx = DLAT * 111.0, DLON * 111.0 * np.cos(np.radians(lat))
    a, b = int(r_km // dy), int(r_km // dx)
    y, x = np.mgrid[-a:a + 1, -b:b + 1]
    return ((y * dy) ** 2 + (x * dx) ** 2 <= r_km ** 2).astype(float)


def _around(day_cells, ci, cj, r_km, what=None):
    """For each candidate square, the number of burning squares (or their summed FRP) within r_km."""
    if not len(day_cells):
        return np.zeros(len(ci))
    ai, aj = decode(day_cells["code"].to_numpy())
    values = np.ones(len(ai)) if what is None else day_cells[what].to_numpy(float)
    k = _disk(r_km, float(np.mean(centre(ci, cj)[0])))
    pa, pb = k.shape[0] // 2, k.shape[1] // 2
    i0, j0 = min(ci.min(), ai.min()) - pa, min(cj.min(), aj.min()) - pb
    i1, j1 = max(ci.max(), ai.max()) + pa, max(cj.max(), aj.max()) + pb
    grid = np.zeros((i1 - i0 + 1, j1 - j0 + 1))
    np.add.at(grid, (ai - i0, aj - j0), values)
    out = fftconvolve(grid, k, mode="same")
    res = out[ci - i0, cj - j0]
    return np.round(res) if what is None else np.maximum(res, 0.0)


def _bearing(lat1, lon1, lat2, lon2):
    """Compass bearing in degrees from point 1 to point 2."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dl = np.radians(lon2 - lon1)
    x = np.sin(dl) * np.cos(p2)
    y = np.cos(p1) * np.sin(p2) - np.sin(p1) * np.cos(p2) * np.cos(dl)
    return (np.degrees(np.arctan2(x, y)) + 360) % 360


def features(days, issue, cand_codes, weather=None):
    """One row per candidate square, for a forecast made on `issue`. No horizon column yet.

    Only fire seen up to and including `issue` is used.
    """
    issue = pd.Timestamp(issue)
    now, prev, prev2 = days.on(issue), days.on(issue - timedelta(days=1)), days.on(issue - timedelta(days=2))
    ci, cj = decode(cand_codes)
    la, lo = centre(ci, cj)
    pts = xyz(la, lo)

    t_now, a_lat, a_lon = _tree(now)
    t_prev, _, _ = _tree(prev)
    t_prev2, _, _ = _tree(prev2)
    d_now, k_now = _nearest(t_now, pts)
    d_prev, _ = _nearest(t_prev, pts)
    d_prev2, _ = _nearest(t_prev2, pts)

    f = pd.DataFrame({"code": cand_codes, "d_now": d_now, "d_prev": d_prev, "d_prev2": d_prev2})
    f["approach"] = np.minimum(d_prev, d_prev2) - d_now          # how much closer the fire got since yesterday

    for r in NEAR_RADII_KM:
        f[f"n_{r}"] = _around(now, ci, cj, r)
    f["frp_10"] = _around(now, ci, cj, 10, "frp")
    f["growth_20"] = f["n_20"] - _around(prev2, ci, cj, 20)

    f["self_now"] = np.isin(cand_codes, now["code"].to_numpy()).astype(int)
    f["self_prev"] = (np.isin(cand_codes, prev["code"].to_numpy())
                      | np.isin(cand_codes, prev2["code"].to_numpy())).astype(int)
    since = days.last_seen(cand_codes, issue - timedelta(days=2), LOOKBACK_DAYS)
    f["burned_season"] = np.isfinite(since).astype(int)
    f["days_since"] = np.where(np.isfinite(since), since + 2, LOOKBACK_DAYS + 3)

    # weather at the nearest fire today, and wind relative to the line from that fire to this square
    if t_now is not None:
        fl, fo = a_lat[k_now], a_lon[k_now]
    else:
        fl, fo = la, lo
    tl, tn = tile_of(fl, fo)
    w = weather_at(weather, tile_key(tl, tn), issue)
    for c in ("wind_ms", "temp_max_c", "humidity_pct", "precip_mm", "rain_3d"):
        f[c] = w[c].to_numpy()
    toward = _bearing(fl, fo, la, lo)
    wind_to = (w["wind_from_deg"].to_numpy() + 180) % 360
    angle = np.radians(toward - wind_to)
    far = d_now > 0.5                                            # direction means nothing for the fire's own square
    f["downwind"] = np.where(far, w["wind_ms"].to_numpy() * np.cos(angle), 0.0)
    f["crosswind"] = np.where(far, np.abs(w["wind_ms"].to_numpy() * np.sin(angle)), 0.0)

    f["doy"] = issue.day_of_year
    f["lat"] = la
    f["lon"] = lo
    f["fire_tile"] = tile_key(tl, tn)                            # not model inputs: kept so weather for later
    f["toward"] = toward                                         # days can be joined on (see weather_ahead)
    return f


def add_ahead(f, ahead, issue, h):
    """Weather expected over issue+1 .. issue+h at each square's nearest fire, as columns AHEAD.

    `ahead` is a weather frame (see weather_frame) of values valid on each day, or
    {lead days: frame} when each lead comes from a different forecast (archived forecasts:
    the value for issue+k is the one forecast k days before). In training it is the
    weather that actually happened.
    """
    issue = pd.Timestamp(issue)
    tiles = f["fire_tile"].to_numpy()
    rows = []
    for k in range(1, h + 1):
        frame = ahead.get(k) if isinstance(ahead, dict) else ahead
        rows.append(weather_at(frame, tiles, issue + pd.Timedelta(days=k), fallback_days=0))
    def stack(col):
        return np.column_stack([r[col].to_numpy(float) for r in rows])
    speed = stack("wind_ms")
    to = (stack("wind_from_deg") + 180) % 360
    angle = np.radians(f["toward"].to_numpy()[:, None] - to)
    far = f["d_now"].to_numpy() > 0.5
    some = np.isfinite(speed).any(axis=1)
    covered = np.isfinite(speed).sum(axis=1)
    with np.errstate(all="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        g = f.copy()
        g["ahead_wind_ms"] = np.nanmean(speed, axis=1)
        g["ahead_downwind"] = np.where(far, np.nanmean(speed * np.cos(angle), axis=1), np.where(some, 0.0, np.nan))
        g["ahead_crosswind"] = np.where(far, np.nanmean(np.abs(speed * np.sin(angle)), axis=1), np.where(some, 0.0, np.nan))
        g["ahead_temp_max"] = np.nanmax(stack("temp_max_c"), axis=1)
        g["ahead_humidity"] = np.nanmean(stack("humidity_pct"), axis=1)
        rain = stack("precip_mm")
        g["ahead_rain"] = np.where(np.isfinite(rain).any(axis=1), np.nansum(rain, axis=1), np.nan)
        g["ahead_days"] = covered                               # not a model input: days with a forecast
    return g


def with_horizon(f, h):
    g = f.copy()
    g["horizon"] = h
    return g


def labels(days, issue, cand_codes, h):
    """1 where VIIRS sees fire on the square on any day from issue + 1 to issue + h."""
    issue = pd.Timestamp(issue)
    future = days.codes_between(issue + timedelta(days=1), issue + timedelta(days=h))
    return np.isin(cand_codes, future).astype(int)


# ----- serving -------------------------------------------------------------------------------

MIN_FORECAST_SHARE = 0.8         # use the forecast model only when this share of squares has forecast weather


def forecast(model, fires, issue, weather, days_ahead=3, lat=None, lon=None, radius_km=None,
             keep_p=0.02, threshold=WARN_P, forecast_model=None, ahead=None, ahead_source=None):
    """Chances of fire per square for 1..days_ahead days after `issue`.

    `fires` are VIIRS hotspots (latitude, longitude, acq_date, frp) up to `issue`,
    covering the circle plus REACH_KM. Only fire inside the circle (when given)
    seeds the forecast. With `forecast_model` and `ahead` (forecast weather for the
    days after `issue`, see add_ahead), days with enough forecast weather use the
    forecast model; the rest use `model`. Returns a dict ready to send.
    """
    issue = pd.Timestamp(issue)
    cells = burning_cells(fires[pd.to_datetime(fires["acq_date"]) <= issue])
    days = Days(cells)
    now = days.on(issue)
    if lat is not None and len(now):
        nla, nlo = centre(*decode(now["code"].to_numpy()))
        inside = _km(lat, lon, nla, nlo) <= radius_km
        seed = now["code"].to_numpy()[inside]
    else:
        seed = now["code"].to_numpy()
    horizons = list(range(1, days_ahead + 1))
    out = {"label": SPREAD_LABEL, "as_of": issue.strftime("%Y-%m-%d"), "days_ahead": days_ahead,
           "threshold": threshold, "burning": [], "cells": [], "place": None, "reasons": [], "weather_used": []}
    if not len(seed):
        out["reasons"].append("No fire was seen inside this circle on that day, so there is nothing to spread.")
        return out

    cand = candidates(seed)
    base = features(days, issue, cand, weather)
    columns = []
    for h in horizons:
        rows = with_horizon(base, h)
        if forecast_model is not None and ahead is not None:
            rows = add_ahead(rows, ahead, issue, h)
            if (rows["ahead_days"] == h).mean() >= MIN_FORECAST_SHARE:
                columns.append(forecast_model.predict_proba(rows[FORECAST_FEATURES])[:, 1])
                out["weather_used"].append("forecast")
                continue
        columns.append(model.predict_proba(rows[FEATURES])[:, 1])
        out["weather_used"].append("today")
    probs = np.column_stack(columns)
    probs = np.maximum.accumulate(probs, axis=1)                 # "within 3 days" cannot be less likely than "within 2"
    keep = probs.max(axis=1) >= keep_p
    sla, slo = centre(*decode(seed))
    out["burning"] = [[round(float(a), 4), round(float(b), 4)] for a, b in zip(sla, slo)]
    out["cells"] = [{"lat": round(float(a), 4), "lon": round(float(b), 4), "new": bool(not s),
                     "p": [round(float(x), 3) for x in p]}
                    for a, b, s, p in zip(base["lat"][keep], base["lon"][keep], base["self_now"][keep], probs[keep])]
    out["cell_size_deg"] = [DLAT, DLON]

    new = base["self_now"].to_numpy() == 0
    for k, h in enumerate(horizons):
        hot = new & (probs[:, k] >= threshold)
        if hot.any():
            reach = float(base["d_now"].to_numpy()[hot].max())
            area = int(hot.sum())
            out["reasons"].append(f"Within {h} day{'s' if h > 1 else ''}: {area} new square{'s' if area > 1 else ''} "
                                  f"(about {area * _cell_km2(lat or float(sla.mean())):.0f} km²) have at least a "
                                  f"{_odds(threshold)} chance of fire, up to {reach:.0f} km from today's fire.")
    centre_tile = tile_key(*tile_of([float(sla.mean())], [float(slo.mean())]))
    w = weather_at(weather, centre_tile, issue).iloc[0]
    used = out["weather_used"]
    if "forecast" in used:
        out["reasons"].extend(_forecast_words(ahead, centre_tile, issue, used, ahead_source))
    if pd.notna(w["wind_ms"]):
        holds = "" if all(u == "forecast" for u in used) else \
            "; days without a forecast assume it holds"
        out["reasons"].append(f"Wind at the fire that day: {w['wind_ms'] * 3.6:.0f} km/h from the "
                              f"{_compass(w['wind_from_deg'])}{holds}.")
    else:
        out["reasons"].append("Weather for that day was not available, so wind is not counted.")

    if lat is not None:
        out["place"] = _place(lat, lon, base, probs, horizons, sla, slo, threshold)
    return out


def _forecast_words(ahead, tile, issue, used, source):
    """One sentence on the forecast wind for the days that used it."""
    parts = []
    for k, u in enumerate(used, 1):
        if u != "forecast":
            continue
        frame = ahead.get(k) if isinstance(ahead, dict) else ahead
        day = pd.Timestamp(issue) + pd.Timedelta(days=k)
        w = weather_at(frame, tile, day, fallback_days=0).iloc[0]
        if pd.notna(w["wind_ms"]):
            parts.append(f"{day.strftime('%-d %b')} {w['wind_ms'] * 3.6:.0f} km/h from the {_compass(w['wind_from_deg'])}")
    if not parts:
        return []
    return [f"Forecast wind at the fire ({source or 'weather forecast'}): " + ", ".join(parts) + "."]


def _place(lat, lon, base, probs, horizons, sla, slo, threshold):
    """The chosen point: nearest fire, and the chance fire reaches within about 2 km of it by each day."""
    d = _km(lat, lon, sla, slo)
    k = int(np.argmin(d))
    near = _km(lat, lon, base["lat"].to_numpy(), base["lon"].to_numpy()) <= 2.5
    p = probs[near].max(axis=0) if near.any() else np.zeros(len(horizons))
    first = next((h for h, x in zip(horizons, p) if x >= threshold), None)
    return {"lat": lat, "lon": lon, "nearest_fire_km": round(float(d[k]), 1),
            "nearest_fire_from": _compass(_bearing(lat, lon, sla[k], slo[k])),
            "p": [round(float(x), 3) for x in p], "warning_by_day": first}


def _odds(p):
    return f"1 in {round(1 / p)}" if p < 0.5 else f"{p:.0%}"


def _km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    h = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(np.asarray(lon2) - lon1) / 2) ** 2
    return 2 * EARTH_KM * np.arcsin(np.sqrt(h))


def _cell_km2(lat):
    return (DLAT * 111.0) * (DLON * 111.0 * np.cos(np.radians(lat)))


def _compass(deg):
    names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
    return names[int(((float(deg) % 360) + 22.5) // 45) % 8]
