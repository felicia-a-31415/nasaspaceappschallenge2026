"""Bring Quebec's hotspot files up to date through the FIRMS API.

Usage: python -m harmonize.refresh [region]      (region defaults to "quebec")

For each dataset already in data/<region>/, fetches the days after the last
one on file, keeps the hotspots inside Quebec's outline, and writes them to a
new fire_nrt_api_<first>_<last>.csv next to the downloads. Existing files are
never edited. Then the pipeline is re-run so the server's tables are current.
"""
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

from harmonize import firms
from harmonize.borders import BOX, in_quebec_mask
from harmonize.schema import source_paths


def _last_day(paths):
    """The latest acq_date across a dataset's files."""
    days = [pd.read_csv(p, usecols=["acq_date"])["acq_date"].max() for p in paths]
    return date.fromisoformat(max(d for d in days if isinstance(d, str)))


def refresh(region="quebec", root=".", fetch=firms.fetch, today=None, key=None):
    """Fetch what is new. Returns {dataset: rows added}."""
    today = today or date.today()
    if key is None and fetch is firms.fetch:
        key = firms.load_key(Path(root) / ".env")
    by_dataset = {}
    for (dataset, _), paths in source_paths(root, region).items():
        by_dataset.setdefault(dataset, []).extend(paths)
    added = {}
    for dataset, paths in by_dataset.items():
        if not paths:
            continue
        first = _last_day(paths) + timedelta(days=1)
        added[dataset] = 0
        if first > today:
            continue
        rows = fetch(dataset, BOX, first, today, key)
        if len(rows):
            rows = rows[in_quebec_mask(rows["latitude"].astype(float), rows["longitude"].astype(float))]
            rows = rows[rows["acq_date"].astype(str) >= first.isoformat()]
        if len(rows):
            name = f"fire_nrt_api_{first:%Y%m%d}_{today:%Y%m%d}.csv"
            rows.to_csv(paths[0].parent / name, index=False)
            added[dataset] = len(rows)
    (Path(root) / "data" / region / "checked_through.txt").write_text(today.isoformat() + "\n")
    return added


if __name__ == "__main__":
    from harmonize.run import main

    region = sys.argv[1] if len(sys.argv) > 1 else "quebec"
    result = refresh(region)
    for dataset, count in result.items():
        print(f"{dataset}: {count} new hotspots")
    main(region)
    print(f"\nData is now current through {date.today().isoformat()}.")
