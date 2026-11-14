"""Turn hotspots into yes/no answers: did this square burn on this day?"""
import numpy as np
import pandas as pd

CELL_DEG = 0.1


def _corner(values, cell_deg):
    # round before floor so 45.0 / 0.1 cannot land a hair under 450
    index = np.floor(np.round(values / cell_deg, 6))
    return np.round(index * cell_deg, 6)


def cell_days(df, cell_deg=CELL_DEG):
    """One row per distinct square, day and sensor."""
    out = pd.DataFrame({
        "date": df["acq_date"].to_numpy(),
        "cell_lat": _corner(df["latitude"].to_numpy(dtype=float), cell_deg),
        "cell_lon": _corner(df["longitude"].to_numpy(dtype=float), cell_deg),
        "sensor": df["sensor"].to_numpy(),
    })
    return out.drop_duplicates().sort_values(["date", "sensor", "cell_lat", "cell_lon"]) \
              .reset_index(drop=True)


def viirs_reference(df):
    """Keep MODIS and Suomi NPP; use NOAA-20 only after Suomi NPP's last date."""
    snpp = df["dataset"] == "viirs_snpp"
    noaa = df["dataset"] == "viirs_noaa20"
    if snpp.any():
        keep_noaa = noaa & (df["acq_date"] > df.loc[snpp, "acq_date"].max())
    else:
        keep_noaa = noaa
    return df[~noaa | keep_noaa].reset_index(drop=True)


def monthly_counts(cd, start, end):
    """Burning square-days per month and sensor, with 0 for empty months."""
    months = pd.period_range(start, end, freq="M")
    counts = cd.groupby([cd["date"].dt.to_period("M"), "sensor"]).size().unstack(fill_value=0)
    counts = counts.reindex(index=months, columns=["MODIS", "VIIRS"], fill_value=0)
    counts.index.name = "month"
    counts.columns.name = None
    return counts
