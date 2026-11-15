"""Fit and test the MODIS-to-VIIRS curve on circles the size users pick.

The region-wide curve is fitted on monthly totals in the thousands. It is not
valid for a 100 km circle, where a month has a handful of burning squares. So
each radius gets its own curve, fitted on monthly counts from random circles
of that radius, and its own hide-a-year test.
"""
import numpy as np
import pandas as pd

from harmonize.calibrate import OVERLAP, fit, lift
from harmonize.grid import monthly_counts
from harmonize.query import RADII_KM, cells_in_circle

MIN_ACTUAL = 10      # circle-years with fewer VIIRS square-days are too small for a percentage
MIN_FIT_ROWS = 30    # fewer circle-months than this cannot support a curve


def circle_samples(cd, radii_km=RADII_KM, n=300, seed=0):
    """Monthly MODIS and VIIRS counts in the overlap years for random circles.

    Centres are squares where VIIRS saw fire at least once in the overlap, so
    circles land where fire happens. Columns: radius_km, circle, month, MODIS, VIIRS.
    """
    start, end = pd.Period(OVERLAP[0], "M"), pd.Period(OVERLAP[1], "M")
    month = cd["date"].dt.to_period("M")
    cd = cd[(month >= start) & (month <= end)]
    squares = cd.loc[cd["sensor"] == "VIIRS", ["cell_lat", "cell_lon"]].drop_duplicates() \
                .sort_values(["cell_lat", "cell_lon"]).to_numpy()
    rng = np.random.default_rng(seed)
    centres = squares[rng.choice(len(squares), size=min(n, len(squares)), replace=False)]
    parts = []
    for radius in radii_km:
        for circle, (lat, lon) in enumerate(centres):
            counts = monthly_counts(cells_in_circle(cd, lat + 0.05, lon + 0.05, radius), start, end)
            parts.append(counts.reset_index().assign(radius_km=radius, circle=circle))
    out = pd.concat(parts, ignore_index=True)
    return out[["radius_km", "circle", "month", "MODIS", "VIIRS"]]


def _fit(rows):
    """Curve from circle-months where MODIS saw something (zero stays zero when lifting)."""
    return fit(rows[rows["MODIS"] > 0])


def _lift_total(rows, model):
    """Predicted VIIRS total per circle: lift each month, leave zero months at zero."""
    value = lift(rows["MODIS"].to_numpy(), model)["value"].to_numpy()
    value = np.where(rows["MODIS"].to_numpy() > 0, value, 0.0)
    return pd.Series(value, index=rows.index).groupby(rows["circle"]).sum()


def circle_models(samples, fallback=None):
    """One fitted curve per radius: {radius_km: {a, b, sigma}}."""
    models = {}
    for radius, rows in samples.groupby("radius_km"):
        enough = (rows["MODIS"] > 0).sum() >= MIN_FIT_ROWS
        if not enough and fallback is None:
            raise ValueError(f"too few circle-months with MODIS fire to fit a curve at {radius} km")
        models[int(radius)] = _fit(rows) if enough else {k: fallback[k] for k in ("a", "b", "sigma")}
    return models


def circle_validation(cd=None, radii_km=RADII_KM, n=300, seed=0, samples=None):
    """Hide each overlap year, fit on the rest, predict the hidden year for every circle.

    One row per radius: how many circle-years were scored, the median percent
    error with no correction and with the curve, and the share of circle-years
    where the curve lands between half and double the actual.
    """
    if samples is None:
        samples = circle_samples(cd, radii_km, n, seed)
    rows_out = []
    for radius, rows in samples.groupby("radius_km"):
        years = rows["month"].dt.year
        scored = []
        for year in sorted(years.unique()):
            held, rest = rows[years == year], rows[years != year]
            if (rest["MODIS"] > 0).sum() < MIN_FIT_ROWS:
                continue
            actual = held.groupby("circle")["VIIRS"].sum()
            scored.append(pd.DataFrame({
                "actual": actual,
                "none": held.groupby("circle")["MODIS"].sum(),
                "curve": _lift_total(held, _fit(rest)),
            }))
        table = pd.concat(scored) if scored else pd.DataFrame(columns=["actual", "none", "curve"])
        table = table[table["actual"] >= MIN_ACTUAL]
        err = lambda col: (table[col] - table["actual"]).abs() / table["actual"] * 100
        within = table["curve"].between(table["actual"] / 2, table["actual"] * 2)
        rows_out.append({
            "radius_km": int(radius),
            "circle_years": len(table),
            "median_err_none": float(err("none").median()) if len(table) else float("nan"),
            "median_err_curve": float(err("curve").median()) if len(table) else float("nan"),
            "within_2x_curve": float(within.mean() * 100) if len(table) else float("nan"),
        })
    return pd.DataFrame(rows_out, columns=["radius_km", "circle_years", "median_err_none",
                                           "median_err_curve", "within_2x_curve"])
