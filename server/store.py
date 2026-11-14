"""The tables the server answers from."""
import json
from dataclasses import dataclass
from pathlib import Path

import pandas as pd


@dataclass
class Table:
    cd: pd.DataFrame            # burning squares: date, cell_lat, cell_lon, sensor
    model: dict                 # region curve, plus "by_radius" curves when present
    data_start: pd.Period
    data_end: pd.Period
    data_through: str           # date of the last hotspot, YYYY-MM-DD
    curve_source: str           # which region the curve was fitted on
    hotspots_path: Path | None = None

    def curve(self, radius_km):
        """The curve fitted for circles of this radius, else the region's."""
        return self.model.get("by_radius", {}).get(str(radius_km), self.model)


def load_region(folder, curve_source="canada"):
    folder = Path(folder)
    cd = pd.read_parquet(folder / "cell_days.parquet")
    hotspots = folder / "hotspots.parquet"
    return Table(
        cd=cd,
        model=json.loads((folder / "model.json").read_text()),
        data_start=cd["date"].min().to_period("M"),
        data_end=cd["date"].max().to_period("M"),
        data_through=cd["date"].max().strftime("%Y-%m-%d"),
        curve_source=curve_source,
        hotspots_path=hotspots if hotspots.exists() else None,
    )
