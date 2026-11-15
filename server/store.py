"""The tables the server answers from."""
import json
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from harmonize.query import distance_km
from harmonize.schema import COLUMNS


@dataclass
class Table:
    cd: pd.DataFrame            # burning squares: date, cell_lat, cell_lon, sensor
    model: dict                 # region curve, plus "by_radius" curves when present
    data_start: pd.Period
    data_end: pd.Period
    data_through: str           # the day the data is complete through, YYYY-MM-DD
    curve_source: str           # which region the curve was fitted on
    hotspots_path: Path | None = None   # one Parquet file, or a folder of <dataset>_<year>.parquet

    def curve(self, radius_km):
        """The curve fitted for circles of this radius, else the region's."""
        return self.model.get("by_radius", {}).get(str(radius_km), self.model)


def load_region(folder, curve_source=None):
    """The preloaded region. Its name (the folder's name) labels the curve."""
    folder = Path(folder)
    cd = pd.read_parquet(folder / "cell_days.parquet")
    model = json.loads((folder / "model.json").read_text())
    through = model.get("data_through") or cd["date"].max().strftime("%Y-%m-%d")
    hotspots = folder / "hotspots.parquet"
    return Table(
        cd=cd,
        model=model,
        data_start=cd["date"].min().to_period("M"),
        data_end=pd.Period(through, "M"),
        data_through=through,
        curve_source=curve_source or folder.name,
        hotspots_path=hotspots if hotspots.exists() else None,
    )


NUMBER_COLUMNS = ("latitude", "longitude", "brightness", "bright_t31", "frp", "scan", "track")


def empty_hotspots():
    """No hotspots, in the shared layout with its column types."""
    types = {c: float for c in NUMBER_COLUMNS} | {"acq_date": "datetime64[ns]", "type": "Int64",
                                                  "type_missing": bool, "likely_static": bool}
    return pd.DataFrame({c: pd.Series(dtype=types.get(c, object)) for c in COLUMNS + ["likely_static"]})


def hotspots_in_circle(table, lat, lon, radius_km, start, end):
    """Raw hotspots (shared layout plus `likely_static`) inside a circle and a month range.

    Returns None when the table has no saved hotspots. Hotspots are placed by
    their own coordinates, not by their square's centre.
    """
    path = table.hotspots_path
    if path is None or not Path(path).exists():
        return None
    reach = radius_km / 111.0
    band = [("latitude", ">=", lat - reach), ("latitude", "<=", lat + reach)]
    if Path(path).is_dir():
        # a file named <dataset>_<year> can run a month into the next year
        files = [f for f in sorted(Path(path).glob("*.parquet"))
                 if start.year - 1 <= int(f.stem.rsplit("_", 1)[1]) <= end.year]
        parts = [pd.read_parquet(f, filters=band) for f in files]
    else:
        parts = [pd.read_parquet(path, filters=band)]
    filled = [p for p in parts if len(p)]
    if not filled:
        # keep the saved column types, so callers can still use .dt and number methods
        return parts[0].iloc[:0].reset_index(drop=True) if parts else empty_hotspots()
    rows = pd.concat(filled, ignore_index=True)
    rows = rows[(rows["acq_date"] >= start.start_time) & (rows["acq_date"] <= end.end_time)]
    inside = distance_km(lat, lon, rows["latitude"].to_numpy(), rows["longitude"].to_numpy()) <= radius_km
    return rows[inside].sort_values(["acq_date", "acq_time"]).reset_index(drop=True)
