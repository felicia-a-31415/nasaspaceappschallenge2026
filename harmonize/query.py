"""Answer for a circle on the map: monthly fire activity and one plain sentence."""
import calendar

import numpy as np
import pandas as pd

from harmonize.calibrate import lift
from harmonize.grid import CELL_DEG, monthly_counts

RADII_KM = (50, 100, 200)
SWITCH = pd.Period("2012-02", "M")          # first full month of VIIRS; run.py uses this one too
TERRA_ONLY_END = pd.Period("2002-07", "M")  # Aqua joins Terra
EARTH_KM = 6371.0
MIN_COMPARISON_YEARS = 5
COLUMNS = ["activity", "low", "high", "estimated", "terra_only", "median"]


def distance_km(lat1, lon1, lat2, lon2):
    """Great-circle distance; lat2 and lon2 may be arrays."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    h = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2) ** 2
    return 2 * EARTH_KM * np.arcsin(np.sqrt(h))


def cells_in_circle(cd, lat, lon, radius_km):
    """Rows of the burning-squares table whose square centre is inside the circle."""
    half = CELL_DEG / 2
    reach = radius_km / 111.0 + CELL_DEG                       # latitude band, a cheap first cut
    near = cd[cd["cell_lat"].between(lat - reach - half, lat + reach)]
    inside = distance_km(lat, lon, near["cell_lat"].to_numpy() + half,
                         near["cell_lon"].to_numpy() + half) <= radius_km
    return near[inside]


def circle_monthly(cd, model, lat, lon, radius_km, start, end, data_start=None, data_end=None):
    """Harmonized activity per month for a circle, clipped to the months we have data for.

    Before VIIRS (Feb 2012) the MODIS count is lifted with the curve; a month
    with no MODIS detections stays at zero. `median` is the usual value for
    that calendar month over the whole data period.
    """
    data_start = pd.Period(data_start or cd["date"].min(), "M")
    data_end = pd.Period(data_end or cd["date"].max(), "M")
    counts = monthly_counts(cells_in_circle(cd, lat, lon, radius_km), data_start, data_end)

    modis = counts["MODIS"].astype(float)
    lifted = lift(modis, model).where(modis > 0, 0.0)
    early = counts.index < SWITCH
    viirs = counts["VIIRS"].astype(float)
    out = pd.DataFrame(index=counts.index)
    out["activity"] = lifted["value"].where(early, viirs)
    out["low"] = lifted["low"].where(early, viirs)
    out["high"] = lifted["high"].where(early, viirs)
    out["estimated"] = early
    out["terra_only"] = counts.index < TERRA_ONLY_END
    out["median"] = out.groupby(out.index.month)["activity"].transform("median")
    first, last = max(pd.Period(start, "M"), data_start), min(pd.Period(end, "M"), data_end)
    return out.loc[first:last, COLUMNS]


def _period_label(year, months):
    if months == list(range(1, 13)):
        return str(year)
    if len(months) == 1:
        return f"{calendar.month_name[months[0]]} {year}"
    return f"{calendar.month_name[months[0]]} to {calendar.month_name[months[-1]]} {year}"


def _sentence(label, total, median, ratio, earlier_higher, first_year):
    if median == 0:
        if total == 0:
            return f"No fire was detected here in {label}. That is normal for this place."
        return f"{label} had fire here. In most years there is none."
    if ratio >= 1.5:
        shown = f"{ratio:.0f}" if ratio >= 10 else f"{ratio:.1f}"
        since = f"since {earlier_higher}" if earlier_higher else f"since records began in {first_year}"
        return f"{label} had {shown} times the usual amount of fire here. The most {since}."
    if ratio <= 0.67:
        return f"{label} had less fire than usual here, about {ratio * 100:.0f}% of the usual amount."
    return f"{label} was about normal for fire here."


def summarize(monthly_full, start, end, through=None):
    """Compare the last year in [start, end] with the same months in every other year.

    `monthly_full` is `circle_monthly` over the whole data period. `through` is
    the last day with data (YYYY-MM-DD); a month it ends part-way through is left
    out, so half a month is not compared with whole ones. Returns None when
    fewer than five other years have all of those months.
    """
    index = monthly_full.index
    start, end = max(pd.Period(start, "M"), index[0]), min(pd.Period(end, "M"), index[-1])
    if through is not None:
        day = pd.Timestamp(through)
        if day.to_period("M") <= end and day.normalize() < day.to_period("M").end_time.normalize():
            end = min(end, day.to_period("M") - 1)
    if start > end:
        return None
    year = end.year
    months = list(range(start.month if start.year == year else 1, end.month + 1))
    picked = monthly_full[index.month.isin(months)]
    by_year = picked.groupby(picked.index.year)["activity"].agg(["sum", "size"])
    totals = by_year.loc[by_year["size"] == len(months), "sum"]
    if year not in totals.index:
        return None
    total, others = float(totals[year]), totals.drop(year)
    if len(others) < MIN_COMPARISON_YEARS:
        return None
    median = float(others.median())
    ratio = total / median if median > 0 else None
    higher_before = others[(others > total) & (others.index < year)]
    sentence = _sentence(_period_label(year, months), total, median, ratio,
                         int(higher_before.index.max()) if len(higher_before) else None,
                         int(others.index.min()))
    return {"year": int(year), "months": months, "total": round(total, 1), "median": round(median, 1),
            "ratio": None if ratio is None else round(ratio, 2),
            "rank": int((others > total).sum()) + 1, "years_compared": int(len(others)),
            "sentence": sentence}


def monthly_csv(monthly):
    """The monthly table as CSV text, activity values to one decimal."""
    out = monthly[COLUMNS].copy()
    out[["activity", "low", "high", "median"]] = out[["activity", "low", "high", "median"]].round(1)
    out.index = out.index.astype(str)
    out.index.name = "month"
    return out.to_csv()
