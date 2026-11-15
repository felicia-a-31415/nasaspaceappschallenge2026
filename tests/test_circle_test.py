import numpy as np
import pandas as pd

from harmonize.circle_test import circle_models, circle_samples, circle_validation


def _synthetic(ratio=1):
    """A 1 by 1 degree patch near (50, -74). Each square burns a few July days a year, 2012 to 2025.

    VIIRS sees every burning day; MODIS sees every `ratio`-th one.
    """
    rng = np.random.default_rng(0)
    rows = []
    for year in range(2012, 2026):
        for i in range(10):
            for j in range(10):
                for day in range(1, int(rng.integers(1, 6)) * ratio + 1):
                    date = f"{year}-07-{day:02d}"
                    rows.append((date, round(50 + i * 0.1, 1), round(-74 + j * 0.1, 1), "VIIRS"))
                    if day % ratio == 0:
                        rows.append((date, round(50 + i * 0.1, 1), round(-74 + j * 0.1, 1), "MODIS"))
    df = pd.DataFrame(rows, columns=["date", "cell_lat", "cell_lon", "sensor"])
    return df.assign(date=pd.to_datetime(df["date"]))


def test_circle_validation_shape_and_perfect_case():
    cd = _synthetic(ratio=1)
    out = circle_validation(cd, radii_km=(100,), n=20, seed=1)
    assert list(out.columns) == ["radius_km", "circle_years", "median_err_none", "median_err_curve", "within_2x_curve"]
    assert out.loc[0, "circle_years"] > 0 and out.loc[0, "median_err_none"] == 0
    assert out.loc[0, "within_2x_curve"] > 90
    pd.testing.assert_frame_equal(out, circle_validation(cd, radii_km=(100,), n=20, seed=1))   # seeded


def test_curve_beats_no_correction_when_modis_sees_a_third():
    out = circle_validation(_synthetic(ratio=3), radii_km=(100,), n=20, seed=1)
    assert out.loc[0, "median_err_none"] > 60
    assert out.loc[0, "median_err_curve"] < 20


def test_circle_models_are_fitted_at_circle_size():
    cd = _synthetic(ratio=3)
    models = circle_models(circle_samples(cd, radii_km=(50, 100), n=20, seed=1))
    assert set(models) == {50, 100} and set(models[50]) == {"a", "b", "sigma"}
    from harmonize.calibrate import lift
    lifted = float(lift(np.array([30.0]), models[100])["value"].iloc[0])
    assert 60 < lifted < 135                       # about three times what MODIS saw
