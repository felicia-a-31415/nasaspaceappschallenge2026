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
