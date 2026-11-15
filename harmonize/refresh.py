"""Bring Quebec's hotspot files up to date through the FIRMS API.

Usage: python -m harmonize.refresh [region]      (region defaults to "quebec")

For each dataset already in data/<region>/, fetches the days after the last
one on file up to yesterday (today is not over, and a day fetched part-way
would never be fetched again), keeps the hotspots inside Quebec's outline, and writes them to a
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


REFRESH_SPAN_DAYS = 1000      # about 2,000 budget units per request, well under the 10-minute limit


def _spans(first, last):
    """(start, end) pieces of at most REFRESH_SPAN_DAYS days covering first..last."""
    out = []
    while first <= last:
        end = min(last, first + timedelta(days=REFRESH_SPAN_DAYS - 1))
        out.append((first, end))
        first = end + timedelta(days=1)
    return out


def refresh(region="quebec", root=".", fetch=firms.fetch, today=None, key=None, wait_for_budget=None):
    """Fetch what is new, through yesterday. Returns {dataset: rows added}."""
    today = today or date.today()
    last = today - timedelta(days=1)
    if key is None and fetch is firms.fetch:
        key = firms.load_key(Path(root) / ".env")
    if wait_for_budget is None:
        wait_for_budget = firms.wait_for_budget if fetch is firms.fetch else (lambda key, needed: None)
    by_dataset = {}
    for (dataset, _), paths in source_paths(root, region).items():
        by_dataset.setdefault(dataset, []).extend(paths)
    added = {}
    for dataset, paths in by_dataset.items():
        if not paths:
            continue
        first = _last_day(paths) + timedelta(days=1)
        added[dataset] = 0
        if first > last:
            continue
        parts = []
        for start, end in _spans(first, last):
            wait_for_budget(key, firms.UNITS_PER_DAY * ((end - start).days + 1))
            parts.append(fetch(dataset, BOX, start, end, key))
        parts = [p for p in parts if len(p)]
        rows = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=firms.FILE_COLUMNS)
        if len(rows):
            rows = rows[in_quebec_mask(rows["latitude"].astype(float), rows["longitude"].astype(float))]
            rows = rows[rows["acq_date"].astype(str) >= first.isoformat()]
        if len(rows):
            name = f"fire_nrt_api_{first:%Y%m%d}_{last:%Y%m%d}.csv"
            rows.to_csv(paths[0].parent / name, index=False)
            added[dataset] = len(rows)
    (Path(root) / "data" / region / "checked_through.txt").write_text(last.isoformat() + "\n")
    return added


if __name__ == "__main__":
    from harmonize.run import main

    region = sys.argv[1] if len(sys.argv) > 1 else "quebec"
    result = refresh(region)
    for dataset, count in result.items():
        print(f"{dataset}: {count} new hotspots")
    main(region)
    print(f"\nData is now current through {date.today() - timedelta(days=1)}.")
