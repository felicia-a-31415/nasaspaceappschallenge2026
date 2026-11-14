"""Is a point, or a circle around it, inside Canada?

Outlines: Natural Earth 1:50m admin-0 countries (public domain), Canada and
the United States only. The Canada hotspot files are a country download, so
the bounding box alone would wrongly claim Alaska and the northern US.
"""
import json
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import shape

_features = json.loads((Path(__file__).parent / "borders.geojson").read_text())["features"]
_shapes = {f["properties"]["name"]: shape(f["geometry"]) for f in _features}
CANADA, USA = _shapes["Canada"], _shapes["United States"]
shapely.prepare(CANADA)
shapely.prepare(USA)

EARTH_KM = 6371.0
EDGE_POINTS = 16


def in_canada_mask(lats, lons):
    """True for each point inside Canada's outline."""
    return shapely.contains_xy(CANADA, np.asarray(lons, dtype=float), np.asarray(lats, dtype=float))


def in_canada(lat, lon):
    return bool(in_canada_mask([lat], [lon])[0])


def _circle_edge(lat, lon, radius_km):
    """Points on the circle's edge, as (lats, lons)."""
    bearing = np.linspace(0, 2 * np.pi, EDGE_POINTS, endpoint=False)
    d, lat1, lon1 = radius_km / EARTH_KM, np.radians(lat), np.radians(lon)
    lat2 = np.arcsin(np.sin(lat1) * np.cos(d) + np.cos(lat1) * np.sin(d) * np.cos(bearing))
    lon2 = lon1 + np.arctan2(np.sin(bearing) * np.sin(d) * np.cos(lat1),
                             np.cos(d) - np.sin(lat1) * np.sin(lat2))
    return np.degrees(lat2), (np.degrees(lon2) + 540) % 360 - 180


def coverage(lat, lon, radius_km):
    """'canada', 'partial' (the circle reaches into the United States) or 'outside'."""
    if not in_canada(lat, lon):
        return "outside"
    lats, lons = _circle_edge(lat, lon, radius_km)
    return "partial" if shapely.contains_xy(USA, lons, lats).any() else "canada"
