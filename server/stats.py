"""Raw hotspot numbers for the map page: the dots, statistics for a circle, the busiest squares.

These are raw detections and raw intensity (fire radiative power, in megawatts),
not the corrected activity. To avoid counting one fire three times, each period
uses one camera: MODIS before February 2012, VIIRS from then on. Numbers from
the two sides of that line are not comparable, and every answer says which
camera it came from.
"""
import json

import numpy as np
import pandas as pd

from harmonize.grid import CELL_DEG, _corner, viirs_reference
from harmonize.query import SWITCH, distance_km
from harmonize.schema import clean

EPOCH = pd.Timestamp("2000-01-01")
KEEP = ["latitude", "longitude", "acq_date", "frp", "sensor"]


def in_use(hotspots):
    """Vegetation fires from the camera in use at the time. Columns: KEEP."""
    rows = viirs_reference(clean(hotspots))
    late = rows["acq_date"] >= SWITCH.start_time
    viirs = rows["sensor"].astype(str) == "VIIRS"
    rows = rows.loc[late == viirs, KEEP].astype({"sensor": str})
    return rows.sort_values("acq_date").reset_index(drop=True)


def camera(year):
    return "VIIRS" if year >= SWITCH.year else "MODIS"


def dots_json(rows, region, data_through, bbox):
    """Every hotspot as parallel lists, sorted by day, ready to send."""
    return json.dumps({
        "region": region, "epoch": EPOCH.strftime("%Y-%m-%d"), "count": len(rows),
        "data_through": data_through, "bbox": list(bbox),
        "lon": rows["longitude"].round(4).tolist(), "lat": rows["latitude"].round(4).tolist(),
        "day": (rows["acq_date"] - EPOCH).dt.days.tolist(),
        "frp": rows["frp"].round(1).tolist(),
        "sensor": (rows["sensor"] == "VIIRS").astype(int).tolist(),
    }, separators=(",", ":")).encode()


def in_circle(rows, lat, lon, radius_km):
    reach = radius_km / 111.0
    near = rows[rows["latitude"].between(lat - reach, lat + reach)]
    inside = distance_km(lat, lon, near["latitude"].to_numpy(), near["longitude"].to_numpy()) <= radius_km
    return near[inside]


def _numbers(rows):
    n = len(rows)
    return {"detections": int(n), "mean_frp": round(float(rows["frp"].mean()), 1) if n else None,
            "sum_frp": round(float(rows["frp"].sum()), 1)}


def circle_stats(rows, start, end, data_through, data_start):
    """Statistics for hotspots already cut to a circle. `rows` covers the whole record.

    by_year covers [start, end]. this_year is the calendar year of `data_through`
    so far; typical_year is the median of the other full years on record
    (from `data_start`) seen by the same camera.
    """
    picked = rows[(rows["acq_date"] >= start.start_time) & (rows["acq_date"] <= end.end_time)]
    out = _numbers(picked)
    per_day = picked.groupby("acq_date").size()
    out["peak_day"] = ({"date": per_day.idxmax().strftime("%Y-%m-%d"), "detections": int(per_day.max())}
                       if len(per_day) else None)
    years = picked["acq_date"].dt.year
    out["by_year"] = [{"year": int(year), **_numbers(picked[years == year]), "sensor": camera(year)}
                      for year in range(start.year, end.year + 1)]

    now = pd.Timestamp(data_through).year
    all_years = rows["acq_date"].dt.year
    out["this_year"] = {"year": int(now), **_numbers(rows[all_years == now])}
    first_full = data_start.year if data_start.month == 1 else data_start.year + 1
    if camera(now) == "VIIRS":
        first_full = max(first_full, SWITCH.year + 1)
    others = [y for y in range(first_full, now) if camera(y) == camera(now)]
    if others:
        grouped = rows.groupby(all_years)["frp"].agg(["size", "sum"]).reindex(others, fill_value=0)
        out["typical_year"] = {"detections": round(float(grouped["size"].median()), 1),
                               "sum_frp": round(float(grouped["sum"].median()), 1), "years": len(others)}
    else:
        out["typical_year"] = None
    return out


def top_areas(rows, start, end, limit=10):
    """The 0.1 degree squares with the highest summed intensity in the month range.

    If the range reaches February 2012 or later, only the newer camera's months
    are ranked, so the two cameras are never added together.
    """
    picked = rows[(rows["acq_date"] >= start.start_time) & (rows["acq_date"] <= end.end_time)]
    sensor = "VIIRS" if end >= SWITCH else "MODIS"
    picked = picked[picked["sensor"] == sensor]
    squares = picked.assign(lat=_corner(picked["latitude"].to_numpy(), CELL_DEG) + CELL_DEG / 2,
                            lon=_corner(picked["longitude"].to_numpy(), CELL_DEG) + CELL_DEG / 2)
    table = squares.groupby(["lat", "lon"])["frp"].agg(sum_frp="sum", detections="size").reset_index()
    table = table.sort_values(["sum_frp", "detections"], ascending=False).head(limit)
    return [{"lat": round(float(r.lat), 2), "lon": round(float(r.lon), 2), "sum_frp": round(float(r.sum_frp), 1),
             "detections": int(r.detections), "sensor": sensor} for r in table.itertuples()]
