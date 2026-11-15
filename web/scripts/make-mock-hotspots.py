#!/usr/bin/env python3
"""Build web/public/mock/hotspots.json, the mock for GET /api/hotspots?region=quebec.

Reads outputs/quebec/hotspots_unified.csv.gz from the harmonization step and writes
the exact payload shape the backend will serve (see frontend handoff, B2). Uses only
the standard library, so no virtual environment is needed.

    python3 web/scripts/make-mock-hotspots.py

The output is about 20 MB and must not be committed (web/.gitignore covers it).
"""
import csv
import gzip
import json
import os
import sys
from datetime import date

EPOCH = date(2000, 1, 1)
BBOX = [-79.8, 44.9, -57.1, 62.6]

root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
src = os.path.join(root, "outputs", "quebec", "hotspots_unified.csv.gz")
dst = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "web", "public", "mock", "hotspots.json")

if not os.path.exists(src):
    sys.exit(f"missing {src}; run the harmonization pipeline first")

rows = []
with gzip.open(src, "rt", newline="") as fh:
    for r in csv.DictReader(fh):
        if r["likely_static"].strip().lower() == "true":
            continue
        try:
            lon = round(float(r["longitude"]), 4)
            lat = round(float(r["latitude"]), 4)
            frp = round(float(r["frp"]), 1)
        except ValueError:
            continue
        d = r["acq_date"]
        rows.append((d, lon, lat, frp, 0 if r["sensor"] == "MODIS" else 1))

rows.sort(key=lambda t: t[0])


def days(iso: str) -> int:
    y, m, d = iso.split("-")
    return (date(int(y), int(m), int(d)) - EPOCH).days


out = {
    "region": "quebec",
    "epoch": EPOCH.isoformat(),
    "count": len(rows),
    "data_through": rows[-1][0],
    "bbox": BBOX,
    "lon": [r[1] for r in rows],
    "lat": [r[2] for r in rows],
    "day": [days(r[0]) for r in rows],
    "frp": [r[3] for r in rows],
    "sensor": [r[4] for r in rows],
}

os.makedirs(os.path.dirname(dst), exist_ok=True)
with open(dst, "w") as fh:
    json.dump(out, fh, separators=(",", ":"))

print(f"{dst}: {len(rows)} hotspots, through {out['data_through']}, "
      f"{os.path.getsize(dst) / 1e6:.1f} MB")
