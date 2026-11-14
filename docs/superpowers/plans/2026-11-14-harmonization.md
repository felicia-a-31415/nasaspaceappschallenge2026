# MODIS/VIIRS Harmonization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the six FIRMS hotspot CSVs into one fire-activity table for Nov 2000 to Nov 2026 in a single unit, with a measured error.

**Architecture:** A small Python package, `harmonize/`, with one module per pipeline stage. Each stage is a pure function on pandas DataFrames; `run.py` chains them and writes files to `outputs/`. Tests use tiny hand-made DataFrames, never the real CSVs.

**Tech Stack:** Python 3.14, pandas, numpy, matplotlib, pytest, in a virtual environment at `.venv/`.

**Spec:** `docs/superpowers/specs/2026-11-14-harmonization-design.md`

## Global Constraints

- Source CSVs under `data/` are never modified.
- All outputs go in `outputs/`. No output file over 100 MB (GitHub limit); the unified hotspot table is written gzipped.
- Square size is 0.1 degrees, set once as `CELL_DEG = 0.1` in `harmonize/grid.py`.
- Rows with `type` 2 or 3 are dropped. Rows with no `type` (recent files) are kept and flagged.
- MODIS confidence maps to levels: under 30 low, 30 to 79 nominal, 80 and up high. VIIRS l/n/h map to low/nominal/high.
- Suomi NPP is the VIIRS reference; NOAA-20 is used only for dates after Suomi NPP's last date.
- Values before 2012-02 are lifted from MODIS and carry `estimated = True`. Months before 2002-07 also carry `terra_only = True`.
- Overlap period for fitting: 2012-02 through 2025-12.

## Review Focus

1. A month with zero MODIS burning squares: the lifted value must be a finite, non-negative number, not NaN or an error from log(0).
2. A month missing entirely from a sensor's data (no rows): it must appear in the monthly output as 0, not be skipped, or the calendar will have holes.
3. Negative longitudes and squares on a boundary (for example lon -73.0 exactly): the square index must use floor, not truncation toward zero.
4. Mixed `confidence` values (numbers as strings in MODIS, letters in VIIRS) and Suomi NPP's `instrument` value "SNPP": the unified table must give `sensor == "VIIRS"` and a valid `confidence_level` for every row.
5. The same square and day reported by both Terra and Aqua, or in both an archive and a recent file: it counts once.

---

### Task 1: Environment and unified hotspot table

**Files:**
- Create: `requirements.txt`, `harmonize/__init__.py`, `harmonize/schema.py`
- Modify: `.gitignore` (add `.venv/`, `__pycache__/`)
- Test: `tests/test_schema.py`

**Interfaces:**
- Produces:
  - `SOURCES: dict[str, dict]` keyed `"modis"`, `"viirs_snpp"`, `"viirs_noaa20"`, each with `archive` and `nrt` paths relative to the repo root.
  - `load_source(path: str | Path) -> pd.DataFrame` reads one CSV with `confidence` as string and `acq_time` as zero-padded string.
  - `unify(df: pd.DataFrame, dataset: str, source_file: str) -> pd.DataFrame` where `dataset` is a `SOURCES` key and `source_file` is `"archive"` or `"nrt"`.
  - `load_all(root: str | Path = ".") -> pd.DataFrame` concatenates all six unified files.
  - Unified columns, in order: `latitude, longitude, acq_date` (datetime64), `acq_time, sensor` ("MODIS"/"VIIRS"), `satellite, dataset, source_file, confidence, confidence_level` ("low"/"nominal"/"high"), `brightness, bright_t31, frp, scan, track, daynight, type` (nullable Int64), `type_missing` (bool), `version`.
  - `clean(df: pd.DataFrame) -> pd.DataFrame` drops rows where `type` is 2 or 3.

- [ ] **Step 1: Set up the environment**

`requirements.txt` lists `pandas`, `numpy`, `matplotlib`, `pytest`. Run: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`. Expected: install succeeds; `.venv/bin/python -c "import pandas"` exits 0.

- [ ] **Step 2: Write the failing tests**

```python
import pandas as pd
from harmonize.schema import unify, clean

def _modis(**kw):
    row = dict(latitude=49.15, longitude=-78.55, brightness=303.7, scan=2.7, track=1.6,
               acq_date="2000-11-07", acq_time="1549", satellite="Terra", instrument="MODIS",
               confidence="57", version="6.03", bright_t31=276.4, frp=40.7, daynight="D", type=0)
    row.update(kw); return pd.DataFrame([row])

def _viirs_nrt(**kw):
    row = dict(latitude=45.3, longitude=-73.5, brightness=299.4, scan=0.57, track=0.52,
               acq_date="2026-08-01", acq_time="0625", satellite="SNPP", instrument="SNPP",
               confidence="n", version="2.0NRT", bright_t31=285.2, frp=1.7, daynight="N")
    row.update(kw); return pd.DataFrame([row])

def test_same_columns_for_every_dataset():
    a = unify(_modis(), "modis", "archive")
    b = unify(_viirs_nrt(), "viirs_snpp", "nrt")
    assert list(a.columns) == list(b.columns)

def test_missing_type_is_flagged_not_dropped():
    b = unify(_viirs_nrt(), "viirs_snpp", "nrt")
    assert b["type"].isna().all() and b["type_missing"].all()
    assert not unify(_modis(), "modis", "archive")["type_missing"].any()

def test_snpp_instrument_label_becomes_viirs():
    assert unify(_viirs_nrt(), "viirs_snpp", "nrt")["sensor"].iloc[0] == "VIIRS"

def test_confidence_levels():
    lv = lambda c: unify(_modis(confidence=c), "modis", "archive")["confidence_level"].iloc[0]
    assert [lv("0"), lv("29"), lv("30"), lv("79"), lv("80"), lv("100")] == \
           ["low", "low", "nominal", "nominal", "high", "high"]
    v = lambda c: unify(_viirs_nrt(confidence=c), "viirs_snpp", "nrt")["confidence_level"].iloc[0]
    assert [v("l"), v("n"), v("h")] == ["low", "nominal", "high"]

def test_clean_drops_type_2_and_3_keeps_missing():
    df = pd.concat([unify(_modis(type=t), "modis", "archive") for t in (0, 2, 3)]
                   + [unify(_viirs_nrt(), "viirs_snpp", "nrt")])
    out = clean(df)
    assert len(out) == 2 and set(out["type"].dropna()) == {0}
```

- [ ] **Step 3: Run to verify failure**

Run: `.venv/bin/pytest tests/test_schema.py -v`. Expected: FAIL, module `harmonize.schema` not found.

- [ ] **Step 4: Implement `harmonize/schema.py`** with the names in Interfaces.

- [ ] **Step 5: Run tests, then check against real data**

Run: `.venv/bin/pytest tests/test_schema.py -v`. Expected: 5 passed.
Run: `.venv/bin/python -c "from harmonize.schema import load_all; d=load_all(); print(len(d), d.sensor.value_counts().to_dict(), d.confidence_level.isna().sum())"`. Expected: 775604 rows, both sensors present, 0 missing confidence levels.

- [ ] **Step 6: Commit** (`feat: unified hotspot table with missing-value flags`)

### Task 2: Source comparison table

**Files:**
- Create: `harmonize/compare.py`
- Test: `tests/test_compare.py`

**Interfaces:**
- Consumes: `load_source`, `SOURCES` from Task 1.
- Produces: `compare_sources(frames: dict[str, pd.DataFrame]) -> pd.DataFrame`. `frames` maps a label such as `"modis archive"` to a raw (not unified) DataFrame. The result has one row per column name found in any frame and one column per label. Each cell is a short string: `"absent"` if the column is missing; for numeric columns `"min to max"`; for columns with 12 or fewer distinct values, the sorted values joined by `", "`; otherwise `"N distinct"`. A final column `differs` is True when the cells in that row are not all equal.

- [ ] **Step 1: Write the failing tests**

```python
import pandas as pd
from harmonize.compare import compare_sources

def test_absent_column_and_differs_flag():
    a = pd.DataFrame({"confidence": ["57", "30"], "type": [0, 2], "daynight": ["D", "N"]})
    b = pd.DataFrame({"confidence": ["n", "h"], "daynight": ["D", "N"]})
    t = compare_sources({"modis archive": a, "viirs nrt": b})
    assert t.loc["type", "viirs nrt"] == "absent"
    assert t.loc["type", "differs"] and t.loc["confidence", "differs"]
    assert not t.loc["daynight", "differs"]
    assert t.loc["daynight", "modis archive"] == "D, N"

def test_numeric_range():
    t = compare_sources({"x": pd.DataFrame({"scan": [1.0, 2.7, 4.8]})})
    assert t.loc["scan", "x"] == "1.0 to 4.8"
```

- [ ] **Step 2: Run to verify failure.** `.venv/bin/pytest tests/test_compare.py -v`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `compare_sources`.** A numeric-looking string column (MODIS `confidence`) is treated as numeric.
- [ ] **Step 4: Run tests.** Expected: 2 passed.
- [ ] **Step 5: Commit** (`feat: source comparison table`)

### Task 3: Burning squares per day

**Files:**
- Create: `harmonize/grid.py`
- Test: `tests/test_grid.py`

**Interfaces:**
- Consumes: the unified, cleaned table from Task 1.
- Produces:
  - `CELL_DEG = 0.1`
  - `cell_days(df: pd.DataFrame, cell_deg: float = CELL_DEG) -> pd.DataFrame` with columns `date, cell_lat, cell_lon` (the square's south-west corner in degrees, rounded to 1 decimal), `sensor`. One row per distinct square, day and sensor.
  - `viirs_reference(df: pd.DataFrame) -> pd.DataFrame` keeps MODIS rows, all `viirs_snpp` rows, and `viirs_noaa20` rows dated after the last `viirs_snpp` date.
  - `monthly_counts(cd: pd.DataFrame, start: str, end: str) -> pd.DataFrame` indexed by month (Period "M") for every month from `start` to `end`, columns `MODIS` and `VIIRS`, value = number of burning square-days, 0 where none.

- [ ] **Step 1: Write the failing tests**

```python
import pandas as pd
from harmonize.grid import cell_days, viirs_reference, monthly_counts

def _df(rows):
    return pd.DataFrame(rows, columns=["latitude", "longitude", "acq_date", "sensor", "dataset"]) \
             .assign(acq_date=lambda d: pd.to_datetime(d.acq_date))

def test_same_square_same_day_counts_once():
    d = _df([(45.11, -73.19, "2020-06-01", "MODIS", "modis"),
             (45.19, -73.11, "2020-06-01", "MODIS", "modis"),
             (45.11, -73.19, "2020-06-02", "MODIS", "modis")])
    assert len(cell_days(d)) == 2

def test_negative_longitude_uses_floor():
    cd = cell_days(_df([(45.0, -73.0, "2020-06-01", "MODIS", "modis"),
                        (45.0, -73.01, "2020-06-01", "MODIS", "modis")]))
    assert sorted(cd.cell_lon) == [-73.1, -73.0]

def test_noaa20_only_after_snpp_ends():
    d = _df([(45, -73, "2026-10-30", "VIIRS", "viirs_snpp"),
             (46, -73, "2026-10-30", "VIIRS", "viirs_noaa20"),
             (46, -73, "2026-11-05", "VIIRS", "viirs_noaa20")])
    out = viirs_reference(d)
    assert len(out) == 2 and (out.dataset == "viirs_noaa20").sum() == 1

def test_empty_months_are_zero_not_missing():
    cd = cell_days(_df([(45, -73, "2020-01-15", "MODIS", "modis"),
                        (45, -73, "2020-03-15", "VIIRS", "viirs_snpp")]))
    m = monthly_counts(cd, "2020-01", "2020-04")
    assert len(m) == 4
    assert m.loc["2020-02"].tolist() == [0, 0] and m.loc["2020-01", "MODIS"] == 1
```

- [ ] **Step 2: Run to verify failure.** `.venv/bin/pytest tests/test_grid.py -v`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `harmonize/grid.py`.** Square index is `numpy.floor(value / cell_deg)`; convert back with `round(index * cell_deg, 1)`.
- [ ] **Step 4: Run tests.** Expected: 4 passed.
- [ ] **Step 5: Commit** (`feat: burning squares per day and monthly counts`)

### Task 4: Fit and test the MODIS-to-VIIRS correction

**Files:**
- Create: `harmonize/calibrate.py`
- Test: `tests/test_calibrate.py`

**Interfaces:**
- Consumes: `monthly_counts` output from Task 3.
- Produces:
  - `fit(monthly: pd.DataFrame) -> dict` with keys `a`, `b`, `sigma`. Model: `log1p(VIIRS) = a + b * log1p(MODIS)`, least squares over the rows given; `sigma` is the residual standard deviation on the log scale.
  - `lift(modis: pd.Series, model: dict) -> pd.DataFrame` with columns `value, low, high`: `expm1(a + b*log1p(modis))` and the same at plus and minus `1.2816 * sigma` (an 80% band), all clipped at 0.
  - `leave_one_year_out(monthly: pd.DataFrame) -> pd.DataFrame` indexed by year with columns `actual` (VIIRS yearly total), `none` (MODIS yearly total unchanged), `fixed` (MODIS times the overall VIIRS/MODIS ratio of the other years), `curve` (yearly sum of `lift` using a fit on the other years), plus `err_none, err_fixed, err_curve` as absolute percentage error against `actual`.

- [ ] **Step 1: Write the failing tests**

```python
import numpy as np, pandas as pd
from harmonize.calibrate import fit, lift, leave_one_year_out

def _monthly():
    idx = pd.period_range("2012-01", "2015-12", freq="M")
    rng = np.random.default_rng(0)
    modis = rng.integers(0, 400, len(idx)).astype(float)
    viirs = np.expm1(0.9 + 0.95 * np.log1p(modis))
    return pd.DataFrame({"MODIS": modis, "VIIRS": viirs}, index=idx)

def test_fit_recovers_known_curve():
    m = fit(_monthly())
    assert abs(m["a"] - 0.9) < 1e-6 and abs(m["b"] - 0.95) < 1e-6 and m["sigma"] < 1e-6

def test_lift_handles_zero_and_orders_bounds():
    out = lift(pd.Series([0.0, 10.0, 1000.0]), {"a": 0.5, "b": 0.9, "sigma": 0.3})
    assert np.isfinite(out.to_numpy()).all() and (out.to_numpy() >= 0).all()
    assert (out.low <= out.value).all() and (out.value <= out.high).all()

def test_leave_one_year_out_shape_and_curve_wins_on_curved_data():
    r = leave_one_year_out(_monthly())
    assert list(r.index) == [2012, 2013, 2014, 2015]
    assert r.err_curve.mean() < 1.0
    assert r.err_curve.mean() < r.err_none.mean()
```

- [ ] **Step 2: Run to verify failure.** `.venv/bin/pytest tests/test_calibrate.py -v`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `harmonize/calibrate.py`.** Use `numpy.polyfit` degree 1 on the log1p values.
- [ ] **Step 4: Run tests.** Expected: 3 passed.
- [ ] **Step 5: Commit** (`feat: MODIS-to-VIIRS curve with leave-one-year-out test`)

### Task 5: Run the pipeline and write outputs

**Files:**
- Create: `harmonize/run.py`
- Test: `tests/test_run.py`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `build_monthly(monthly: pd.DataFrame, model: dict) -> pd.DataFrame` indexed by month with columns `activity, low, high, estimated, terra_only, sensor_used`. Before 2012-02: `lift` of MODIS, `estimated=True`, `sensor_used="MODIS"`. From 2012-02: VIIRS count, `low == high == activity`, `estimated=False`, `sensor_used="VIIRS"`. `terra_only=True` before 2002-07.
  - `python -m harmonize.run` writes, under `outputs/`: `source_comparison.csv`, `hotspots_unified.csv.gz`, `harmonized_daily.csv` (columns `date, cell_lat, cell_lon, sensor_used`; MODIS squares before 2012-02, VIIRS reference squares after), `harmonized_monthly.csv`, `validation.csv`, `model.json`, and charts `before.png` (monthly raw hotspot counts for the three datasets, log y-axis), `after.png` (the harmonized monthly series with the band shaded where estimated), `validation.png` (per-year error for none, fixed and curve). It prints the comparison table and the mean error of each method.

- [ ] **Step 1: Write the failing test**

```python
import pandas as pd
from harmonize.run import build_monthly

def test_build_monthly_flags_and_switch():
    idx = pd.period_range("2001-01", "2013-12", freq="M")
    monthly = pd.DataFrame({"MODIS": 10.0, "VIIRS": 0.0}, index=idx)
    monthly.loc["2012-02":, "VIIRS"] = 25.0
    out = build_monthly(monthly, {"a": 0.5, "b": 1.0, "sigma": 0.2})
    assert out.loc["2011-12", "estimated"] and not out.loc["2012-02", "estimated"]
    assert out.loc["2012-02", "activity"] == 25.0 and out.loc["2012-02", "sensor_used"] == "VIIRS"
    assert out.loc["2002-06", "terra_only"] and not out.loc["2002-07", "terra_only"]
    assert out.loc["2005-06", "low"] < out.loc["2005-06", "activity"] < out.loc["2005-06", "high"]
    assert len(out) == len(idx)
```

- [ ] **Step 2: Run to verify failure.** `.venv/bin/pytest tests/test_run.py -v`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `harmonize/run.py`.**
- [ ] **Step 4: Run all tests.** `.venv/bin/pytest -v`. Expected: 15 passed.
- [ ] **Step 5: Run on the real data and check the result**

Run: `.venv/bin/python -m harmonize.run`. Expected: all nine files exist in `outputs/`; none exceeds 100 MB; `harmonized_monthly.csv` has 313 rows (2000-11 through 2026-11) with no blanks in `activity`; printed mean error for `curve` is lower than for `none`. Open `after.png` and confirm there is no step at 2012. If `curve` does not beat `fixed`, report that plainly rather than tuning until it does.

- [ ] **Step 6: Commit** (`feat: harmonization pipeline outputs and charts`)
