import numpy as np
import pandas as pd
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
