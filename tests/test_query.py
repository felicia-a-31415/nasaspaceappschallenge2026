import csv
import io

import pandas as pd

from harmonize.query import cells_in_circle, circle_monthly, monthly_csv, summarize

MODEL = {"a": 1.0, "b": 1.0, "sigma": 0.5}


def _cd(rows):   # rows: (date, cell_lat, cell_lon, sensor)
    df = pd.DataFrame(rows, columns=["date", "cell_lat", "cell_lon", "sensor"])
    return df.assign(date=pd.to_datetime(df["date"]))


def _series(july_by_year):
    """A full-period monthly table with all of a year's activity in July."""
    years = sorted(july_by_year)
    idx = pd.period_range(f"{years[0]}-01", f"{years[-1]}-12", freq="M", name="month")
    activity = pd.Series(0.0, index=idx)
    for year, value in july_by_year.items():
        activity[pd.Period(f"{year}-07")] = value
    return pd.DataFrame({"activity": activity, "low": activity, "high": activity,
                         "estimated": idx < pd.Period("2012-02"), "terra_only": False, "median": 0.0})


def test_circle_uses_square_centres():
    cd = _cd([("2015-07-01", 50.0, -74.0, "VIIRS"),     # centre about 5 km from the click
              ("2015-07-01", 52.0, -74.0, "VIIRS")])    # about 225 km away
    assert len(cells_in_circle(cd, 50.05, -74.0, 50)) == 1
    assert len(cells_in_circle(cd, 50.05, -74.0, 200)) == 1
    assert len(cells_in_circle(cd, 51.0, -74.0, 200)) == 2


def test_monthly_switches_sensor_and_keeps_zero_at_zero():
    cd = _cd([("2005-07-01", 50.0, -74.0, "MODIS"), ("2005-07-02", 50.0, -74.0, "MODIS"),
              ("2015-07-01", 50.0, -74.0, "VIIRS"), ("2015-07-01", 50.0, -74.0, "MODIS")])
    m = circle_monthly(cd, MODEL, 50.05, -74.0, 100, "2005-01", "2015-12", data_start="2005-01", data_end="2015-12")
    assert m.index[0] == pd.Period("2005-01") and m.index[-1] == pd.Period("2015-12")
    assert circle_monthly(cd, MODEL, 50.05, -74.0, 100, "2000-01", "2030-12").index[0] == pd.Period("2005-07")
    assert m.loc["2005-07", "estimated"]
    assert m.loc["2005-07", "low"] < m.loc["2005-07", "activity"] < m.loc["2005-07", "high"]
    assert m.loc["2005-06", ["activity", "low", "high"]].tolist() == [0, 0, 0]
    assert m.loc["2015-07", ["activity", "low", "high"]].tolist() == [1, 1, 1] and not m.loc["2015-07", "estimated"]
    assert list(m.columns) == ["activity", "low", "high", "estimated", "terra_only", "median"]


def test_median_is_per_calendar_month_over_the_whole_period():
    cd = _cd([(f"{y}-07-0{d}", 50.0, -74.0, "VIIRS") for y, n in ((2013, 1), (2014, 3), (2015, 5)) for d in range(1, n + 1)])
    m = circle_monthly(cd, MODEL, 50.05, -74.0, 100, "2015-01", "2015-12", data_start="2013-01", data_end="2015-12")
    assert m.loc["2015-07", "median"] == 3 and m.loc["2015-06", "median"] == 0 and len(m) == 12


def test_no_fire_anywhere_gives_calm_sentence():          # Review Focus 1
    cd = _cd([("2001-07-01", 60.0, -100.0, "MODIS"), ("2026-07-01", 60.0, -100.0, "VIIRS")])
    full = circle_monthly(cd, MODEL, 0.0, 0.0, 100, "2001-01", "2026-12", data_start="2001-01", data_end="2026-12")
    assert full["activity"].sum() == 0 and not full.isna().any().any()
    s = summarize(full, "2026-01", "2026-12")
    assert s["ratio"] is None and s["sentence"] == "No fire was detected here in 2026. That is normal for this place."


def test_fire_where_there_is_usually_none():
    s = summarize(_series({y: 0 for y in range(2001, 2027)} | {2023: 4}), "2023-01", "2023-12")
    assert s["ratio"] is None and s["sentence"] == "2023 had fire here. In most years there is none."


def test_sentence_for_a_big_year():
    full = _series({y: 10 for y in range(2001, 2027)} | {2013: 80, 2023: 90})
    s = summarize(full, "2023-01", "2023-12")
    assert s["ratio"] == 9.0 and s["rank"] == 1 and s["years_compared"] == 25 and s["year"] == 2023
    assert s["sentence"] == "2023 had 9.0 times the usual amount of fire here. The most since records began in 2001."
    assert summarize(full, "2013-01", "2013-12")["sentence"].startswith("2013 had 8.0 times")
    later = summarize(_series({y: 10 for y in range(2001, 2027)} | {2013: 80, 2023: 50}), "2023-01", "2023-12")
    assert later["rank"] == 2 and later["sentence"] == "2023 had 5.0 times the usual amount of fire here. The most since 2013."
    huge = summarize(_series({y: 10 for y in range(2001, 2027)} | {2023: 123}), "2023-01", "2023-12")
    assert huge["sentence"].startswith("2023 had 12 times")


def test_sentence_for_a_quiet_year():
    s = summarize(_series({y: 10 for y in range(2001, 2027)} | {2020: 2}), "2020-01", "2020-12")
    assert s["sentence"] == "2020 had less fire than usual here, about 20% of the usual amount."


def test_sentence_for_part_of_a_year_and_single_month():  # Review Focus 5
    full = _series({y: 10 for y in range(2001, 2027)})
    assert summarize(full, "2020-05", "2024-09")["sentence"] == "January to September 2024 was about normal for fire here."
    assert summarize(full, "2024-05", "2024-09")["sentence"] == "May to September 2024 was about normal for fire here."
    assert summarize(full, "2024-07", "2024-07")["sentence"] == "July 2024 was about normal for fire here."


def test_a_month_still_in_progress_is_left_out_of_the_comparison():
    full = _series({y: 10 for y in range(2001, 2027)})
    s = summarize(full, "2026-01", "2026-07", through="2026-07-14")
    assert s["months"] == list(range(1, 7)) and "January to June 2026" in s["sentence"]
    assert summarize(full, "2026-01", "2026-07", through="2026-07-31")["months"] == list(range(1, 8))
    assert summarize(full, "2026-07", "2026-07", through="2026-07-14") is None


def test_too_few_years_gives_no_summary():
    assert summarize(_series({2024: 5, 2025: 5, 2026: 5}), "2026-01", "2026-12") is None


def test_monthly_csv_columns_and_rounding():
    full = _series({2024: 5, 2025: 7.26})
    rows = list(csv.DictReader(io.StringIO(monthly_csv(full))))
    assert list(rows[0]) == ["month", "activity", "low", "high", "estimated", "terra_only", "median"]
    assert rows[6]["month"] == "2024-07" and rows[18]["activity"] == "7.3" and len(rows) == 24
