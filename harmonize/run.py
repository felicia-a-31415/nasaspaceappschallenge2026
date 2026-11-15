"""Run the whole harmonization and write tables and charts to outputs/.

Usage: python -m harmonize.run [region]      (region defaults to "quebec")
"""
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from harmonize.calibrate import OVERLAP, fit, leave_one_year_out, lift
from harmonize.circle_test import circle_models, circle_samples, circle_validation
from harmonize.compare import compare_sources
from harmonize.grid import cell_days, monthly_counts, viirs_reference
from harmonize.schema import clean, flag_static, load_all, load_source, source_paths

SWITCH = pd.Period("2012-02", "M")          # first full month of VIIRS
TERRA_ONLY_END = pd.Period("2002-07", "M")  # Aqua joins Terra
CSV_MAX_ROWS = 2_000_000                    # above this the unified table is Parquet only


def build_monthly(monthly, model):
    """One series in VIIRS-level square-days: lifted MODIS, then VIIRS itself."""
    lifted = lift(monthly["MODIS"], model)
    early = monthly.index < SWITCH
    out = pd.DataFrame(index=monthly.index)
    out["activity"] = lifted["value"].where(early, monthly["VIIRS"].astype(float))
    out["low"] = lifted["low"].where(early, out["activity"])
    out["high"] = lifted["high"].where(early, out["activity"])
    out["estimated"] = early
    out["terra_only"] = monthly.index < TERRA_ONLY_END
    out["sensor_used"] = pd.Series(early, index=monthly.index).map({True: "MODIS", False: "VIIRS"})
    return out


def build_daily(cd):
    """Burning squares per day from whichever sensor the monthly series uses."""
    month = cd["date"].dt.to_period("M")
    use = ((cd["sensor"] == "MODIS") & (month < SWITCH)) | ((cd["sensor"] == "VIIRS") & (month >= SWITCH))
    return cd[use].rename(columns={"sensor": "sensor_used"}).reset_index(drop=True)


def _plot_before(hotspots, path):
    raw = hotspots.groupby([hotspots["acq_date"].dt.to_period("M"), "dataset"]).size().unstack()
    labels = {"modis": "MODIS", "viirs_snpp": "VIIRS (Suomi NPP)", "viirs_noaa20": "VIIRS (NOAA-20)"}
    fig, ax = plt.subplots(figsize=(11, 4.5))
    for key, label in labels.items():
        if key in raw:
            series = raw[key].dropna()
            ax.plot(series.index.to_timestamp(), series.values, label=label, linewidth=1)
    ax.set_yscale("log")
    ax.set_ylabel("hotspots per month (log scale)")
    ax.set_title("Before: raw hotspot counts disagree between sensors")
    ax.legend()
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def _plot_after(monthly, harmonized, path):
    x = harmonized.index.to_timestamp()
    est = harmonized["estimated"].to_numpy()
    fig, ax = plt.subplots(figsize=(11, 4.5))
    ax.fill_between(x[est], harmonized["low"][est] + 1, harmonized["high"][est] + 1,
                    alpha=0.25, color="tab:orange", label="80% band (estimated from MODIS)")
    ax.plot(x, monthly["MODIS"] + 1, color="grey", linewidth=0.8, linestyle=":", label="MODIS, uncorrected")
    ax.plot(x, harmonized["activity"] + 1, color="tab:red", linewidth=1.2, label="harmonized")
    ax.axvline(SWITCH.to_timestamp(), color="black", linewidth=0.8, linestyle="--")
    ax.set_yscale("log")
    ax.set_ylabel("burning square-days per month, plus 1 (log scale)")
    ax.set_title("After: one series at VIIRS level (dashed line: VIIRS takes over)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def _plot_validation(validation, path):
    labels = {"err_none": "no correction", "err_fixed": "fixed multiplier", "err_curve": "our curve"}
    fig, ax = plt.subplots(figsize=(11, 4.5))
    validation[list(labels)].rename(columns=labels).plot.bar(ax=ax, width=0.8)
    ax.set_ylabel("error predicting the hidden year (%)")
    ax.set_xlabel("year hidden from the fit")
    ax.set_title("Test: predict each year's VIIRS total from MODIS alone")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def data_through(root, region, last_hotspot):
    """The day the data is complete through: the last hotspot, or the last refresh if later.

    `harmonize.refresh` records the day it checked in data/<region>/checked_through.txt,
    so a quiet week still counts as up to date.
    """
    through = pd.Timestamp(last_hotspot).strftime("%Y-%m-%d")
    note = Path(root) / "data" / region / "checked_through.txt"
    if note.exists():
        through = max(through, note.read_text().strip())
    return through


def main(region="quebec", root="."):
    out_dir = Path(root) / "outputs" / region
    out_dir.mkdir(parents=True, exist_ok=True)

    raw = {f"{dataset} {kind}": pd.concat([load_source(p) for p in paths])
           for (dataset, kind), paths in source_paths(root, region).items() if paths}
    comparison = compare_sources(raw)
    comparison.to_csv(out_dir / "source_comparison.csv")
    del raw

    hotspots = flag_static(load_all(root, region))
    hotspots.sort_values("latitude").to_parquet(out_dir / "hotspots.parquet", index=False)
    if len(hotspots) < CSV_MAX_ROWS:
        hotspots.to_csv(out_dir / "hotspots_unified.csv.gz", index=False)

    # both sensors over the whole period: the web server re-does the correction per circle
    cd = cell_days(viirs_reference(clean(hotspots)))
    cd.to_parquet(out_dir / "cell_days.parquet", index=False)
    through = data_through(root, region, hotspots["acq_date"].max())
    start = hotspots["acq_date"].min().to_period("M")
    end = pd.Period(through, "M")
    monthly = monthly_counts(cd, start, end)

    overlap = monthly.loc[OVERLAP[0]:OVERLAP[1]]
    model = fit(overlap)
    validation = leave_one_year_out(overlap)
    harmonized = build_monthly(monthly, model)

    build_daily(cd).to_csv(out_dir / "harmonized_daily.csv", index=False)
    harmonized.round(1).to_csv(out_dir / "harmonized_monthly.csv")
    validation.round(1).to_csv(out_dir / "validation.csv")
    # the region-wide curve is only right for region-wide totals; circles get their own
    samples = circle_samples(cd)
    circle_check = circle_validation(cd, samples=samples)
    circle_check.round(1).to_csv(out_dir / "circle_validation.csv", index=False)
    by_radius = {str(radius): m for radius, m in circle_models(samples, fallback=model).items()}
    (out_dir / "model.json").write_text(json.dumps(
        {**model, "cell_deg": 0.1, "fit_months": list(OVERLAP), "switch_month": str(SWITCH),
         "by_radius": by_radius, "data_through": through}, indent=2))

    _plot_before(hotspots, out_dir / "before.png")
    _plot_after(monthly, harmonized, out_dir / "after.png")
    _plot_validation(validation, out_dir / "validation.png")

    with pd.option_context("display.width", 250, "display.max_columns", None, "display.max_colwidth", 28):
        print(comparison)
        print()
        print(validation.round(1))
    print("\nMean error predicting a hidden year (%):")
    print(validation[["err_none", "err_fixed", "err_curve"]].mean().round(1).to_string())
    print("\nSame test on circles the size users pick:")
    print(circle_check.round(1).to_string(index=False))
    print(f"\nWrote {out_dir}/")


if __name__ == "__main__":
    main(*sys.argv[1:2])
