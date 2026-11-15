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


def _write_tiny_region(root, region):
    """MODIS in 2005 and in the overlap years; VIIRS in the overlap years, growing month to month."""
    def rows(sat, conf, version, spots):
        return pd.DataFrame([dict(latitude=50.01 + 0.1 * i, longitude=-74.01, brightness=310.0, scan=1.0,
                                  track=1.0, acq_date=d, acq_time="1700", satellite=sat, instrument="X",
                                  confidence=conf, version=version, bright_t31=280.0, frp=10.0,
                                  daynight="D", type=0) for d, n in spots for i in range(n)])
    overlap = [("2015-06-10", 1), ("2015-07-10", 2), ("2016-07-10", 3), ("2017-08-10", 5)]
    for name, df in {"modis": rows("Terra", "60", "6.03", [("2005-07-10", 2)] + overlap),
                     "viirs_snpp": rows("N", "n", "2", [(d, n * 2) for d, n in overlap])}.items():
        folder = root / "data" / region / name
        folder.mkdir(parents=True)
        df.to_csv(folder / "fire_archive_test.csv", index=False)


def test_main_writes_both_sensor_table(tmp_path):
    from harmonize.run import main
    _write_tiny_region(tmp_path, "tiny")
    main("tiny", root=tmp_path)
    cd = pd.read_parquet(tmp_path / "outputs/tiny/cell_days.parquet")
    assert list(cd.columns) == ["date", "cell_lat", "cell_lon", "sensor"]
    assert set(cd["sensor"]) == {"MODIS", "VIIRS"}
    assert ((cd["sensor"] == "MODIS") & (cd["date"].dt.year == 2015)).any()   # MODIS kept after 2012
    assert (tmp_path / "outputs/tiny/hotspots.parquet").exists()
    assert (tmp_path / "outputs/tiny/hotspots_unified.csv.gz").exists()        # small regions keep the CSV
