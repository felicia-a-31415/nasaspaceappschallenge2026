"""Load the six FIRMS hotspot files into one table with identical columns."""
from pathlib import Path

import numpy as np
import pandas as pd

# Folder for each dataset inside data/<region>/. Each holds one
# fire_archive_*.csv (science quality) and one fire_nrt_*.csv (recent months).
SOURCES = {
    "modis": {"archive": "modis/fire_archive_*.csv", "nrt": "modis/fire_nrt_*.csv"},
    "viirs_snpp": {"archive": "viirs_snpp/fire_archive_*.csv", "nrt": "viirs_snpp/fire_nrt_*.csv"},
    "viirs_noaa20": {"archive": "viirs_noaa20/fire_archive_*.csv", "nrt": "viirs_noaa20/fire_nrt_*.csv"},
}

SENSOR = {"modis": "MODIS", "viirs_snpp": "VIIRS", "viirs_noaa20": "VIIRS"}

COLUMNS = [
    "latitude", "longitude", "acq_date", "acq_time", "sensor", "satellite",
    "dataset", "source_file", "confidence", "confidence_level", "brightness",
    "bright_t31", "frp", "scan", "track", "daynight", "type", "type_missing",
    "version",
]

VIIRS_LEVELS = {"l": "low", "n": "nominal", "h": "high"}

# Text columns with few distinct values. Stored as categories to save memory.
CATEGORICAL = ["sensor", "satellite", "dataset", "source_file", "confidence_level", "daynight", "version"]


def load_source(path):
    """Read one FIRMS CSV, keeping confidence, time and version as text."""
    return pd.read_csv(path, dtype={"confidence": str, "acq_time": str, "version": str})


def _confidence_level(conf, dataset):
    conf = conf.astype(str).str.strip()
    if SENSOR[dataset] == "VIIRS":
        return conf.str.lower().map(VIIRS_LEVELS)
    num = pd.to_numeric(conf, errors="coerce")
    level = np.select([num < 30, num < 80, num >= 80], ["low", "nominal", "high"], default=None)
    return pd.Series(level, index=conf.index, dtype=object)


def unify(df, dataset, source_file):
    """Put one raw file into the shared layout, flagging values it lacks."""
    out = pd.DataFrame(index=df.index)
    out["latitude"] = df["latitude"].astype(float)
    out["longitude"] = df["longitude"].astype(float)
    out["acq_date"] = pd.to_datetime(df["acq_date"])
    out["acq_time"] = df["acq_time"].astype(str).str.zfill(4)
    out["sensor"] = SENSOR[dataset]
    out["satellite"] = df["satellite"]
    out["dataset"] = dataset
    out["source_file"] = source_file
    out["confidence"] = df["confidence"].astype(str)
    out["confidence_level"] = _confidence_level(df["confidence"], dataset)
    for col in ("brightness", "bright_t31", "frp", "scan", "track"):
        out[col] = df[col].astype(float)
    out["daynight"] = df["daynight"]
    if "type" in df.columns:
        out["type"] = df["type"].astype("Int64")
    else:
        out["type"] = pd.array([pd.NA] * len(df), dtype="Int64")
    out["type_missing"] = out["type"].isna()
    out["version"] = df["version"].astype(str)
    return _categorise(out[COLUMNS].reset_index(drop=True))


def _categorise(df):
    return df.astype({col: "category" for col in CATEGORICAL})


def source_paths(root=".", region="quebec"):
    """Map (dataset, source_file) to the CSV files found for a region."""
    base = Path(root) / "data" / region
    return {
        (dataset, source_file): sorted(base.glob(pattern))
        for dataset, files in SOURCES.items()
        for source_file, pattern in files.items()
    }


def load_all(root=".", region="quebec"):
    """Every file for a region, unified and stacked."""
    parts = [
        unify(load_source(path), dataset, source_file)
        for (dataset, source_file), paths in source_paths(root, region).items()
        for path in paths
    ]
    if not parts:
        raise FileNotFoundError(f"no FIRMS CSV files under {Path(root) / 'data' / region}")
    # files have different category sets, so concat falls back to text: re-apply
    return _categorise(pd.concat(parts, ignore_index=True))


STATIC_CELL_DEG = 0.01   # about 1 km
STATIC_MIN_HITS = 3


def _static_key(df):
    lat = np.floor(np.round(df["latitude"] / STATIC_CELL_DEG, 6)).astype("int64")
    lon = np.floor(np.round(df["longitude"] / STATIC_CELL_DEG, 6)).astype("int64")
    return lat * 1_000_000 + lon


def flag_static(df):
    """Add `likely_static`: the spot has repeated non-fire detections (type 2 or 3).

    The recent (nrt) files carry no `type`, so smelters, mills and flares in
    them can only be recognised by where the archive has already seen them.
    """
    key = _static_key(df)
    hits = key[df["type"].isin([2, 3])].value_counts()
    static = set(hits[hits >= STATIC_MIN_HITS].index)
    return df.assign(likely_static=key.isin(static).to_numpy())


def clean(df):
    """Keep vegetation fires: drop type 2 and 3, and unlabelled rows on static spots."""
    if "likely_static" not in df.columns:
        df = flag_static(df)
    drop = df["type"].isin([2, 3]) | (df["type_missing"] & df["likely_static"])
    return df[~drop].reset_index(drop=True)
