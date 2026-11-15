"""Is a point, or a circle around it, inside Quebec?

The Quebec hotspot files hold hotspots inside the province's outline only, so
the bounding box alone would wrongly claim parts of Ontario, Labrador, New
Brunswick and Maine.

Outlines (Natural Earth, public domain): Quebec from the 1:10m provinces
layer, simplified; Canada and the United States from the 1:50m countries
layer, used only to tell neighbouring land from sea.
"""
import json
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import shape

_features = json.loads((Path(__file__).parent / "borders.geojson").read_text())["features"]
_shapes = {f["properties"]["name"]: shape(f["geometry"]) for f in _features}
QUEBEC = _shapes["Quebec"]
LAND = (_shapes["Canada"], _shapes["United States"])
for _shape in (QUEBEC, *LAND):
    shapely.prepare(_shape)

_w, _s, _e, _n = QUEBEC.bounds
BOX = (np.floor(_w * 10) / 10, np.floor(_s * 10) / 10, np.ceil(_e * 10) / 10, np.ceil(_n * 10) / 10)
BOX = tuple(float(v) for v in BOX)   # west, south, east, north, widened to tenths of a degree
EARTH_KM = 6371.0
EDGE_POINTS = 16


def in_quebec_mask(lats, lons):
    """True for each point inside Quebec's outline."""
    return shapely.contains_xy(QUEBEC, np.asarray(lons, dtype=float), np.asarray(lats, dtype=float))


def in_quebec(lat, lon):
    return bool(in_quebec_mask([lat], [lon])[0])


def _circle_edge(lat, lon, radius_km):
    """Points on the circle's edge, as (lats, lons)."""
    bearing = np.linspace(0, 2 * np.pi, EDGE_POINTS, endpoint=False)
    d, lat1, lon1 = radius_km / EARTH_KM, np.radians(lat), np.radians(lon)
    lat2 = np.arcsin(np.sin(lat1) * np.cos(d) + np.cos(lat1) * np.sin(d) * np.cos(bearing))
    lon2 = lon1 + np.arctan2(np.sin(bearing) * np.sin(d) * np.cos(lat1),
                             np.cos(d) - np.sin(lat1) * np.sin(lat2))
    return np.degrees(lat2), (np.degrees(lon2) + 540) % 360 - 180


def coverage(lat, lon, radius_km):
    """Where a circle sits relative to Quebec.

    'outside': the centre is not in Quebec.
    'partial': the centre is in Quebec and the circle reaches land in another
               province or in the United States.
    'inside':  otherwise (a circle reaching over the sea is still 'inside').
    """
    if not in_quebec(lat, lon):
        return "outside"
    lats, lons = _circle_edge(lat, lon, radius_km)
    beyond = ~in_quebec_mask(lats, lons)
    on_land = np.zeros(len(lats), dtype=bool)
    for country in LAND:
        on_land |= shapely.contains_xy(country, lons, lats)
    return "partial" if (beyond & on_land).any() else "inside"
