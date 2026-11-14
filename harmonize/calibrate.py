"""Learn how MODIS activity translates to VIIRS activity, and test it."""
import numpy as np
import pandas as pd

Z80 = 1.2816  # half-width of an 80% band, in standard deviations


def fit(monthly):
    """Straight line on a log scale: log1p(VIIRS) = a + b * log1p(MODIS)."""
    x = np.log1p(monthly["MODIS"].to_numpy(dtype=float))
    y = np.log1p(monthly["VIIRS"].to_numpy(dtype=float))
    b, a = np.polyfit(x, y, 1)
    sigma = float(np.std(y - (a + b * x)))
    return {"a": float(a), "b": float(b), "sigma": sigma}


def lift(modis, model):
    """MODIS square-days raised to VIIRS level, with an 80% band."""
    centre = model["a"] + model["b"] * np.log1p(np.asarray(modis, dtype=float))
    spread = Z80 * model["sigma"]
    out = pd.DataFrame({
        "value": np.expm1(centre),
        "low": np.expm1(centre - spread),
        "high": np.expm1(centre + spread),
    }, index=getattr(modis, "index", None))
    return out.clip(lower=0)


def leave_one_year_out(monthly):
    """Hide each year, fit on the rest, and compare three ways of predicting it."""
    years = monthly.index.year
    rows = {}
    for year in sorted(set(years)):
        held, rest = monthly[years == year], monthly[years != year]
        ratio = rest["VIIRS"].sum() / rest["MODIS"].sum()
        rows[year] = {
            "actual": held["VIIRS"].sum(),
            "none": held["MODIS"].sum(),
            "fixed": held["MODIS"].sum() * ratio,
            "curve": lift(held["MODIS"], fit(rest))["value"].sum(),
        }
    out = pd.DataFrame.from_dict(rows, orient="index")
    out.index.name = "year"
    for method in ("none", "fixed", "curve"):
        out[f"err_{method}"] = (out[method] - out["actual"]).abs() / out["actual"] * 100
    return out
