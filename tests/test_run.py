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
