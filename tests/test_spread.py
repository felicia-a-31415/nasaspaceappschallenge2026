from datetime import date

import numpy as np
import pandas as pd
import pytest

from server import spread


def fires(rows):
    """rows: (day, lat, lon[, frp])"""
    out = pd.DataFrame([r if len(r) == 4 else (*r, 10.0) for r in rows],
                       columns=["acq_date", "latitude", "longitude", "frp"])
    out["acq_date"] = pd.to_datetime(out["acq_date"])
    return out


class ByDistance:
    """Stands in for the trained model: close squares and longer horizons are likelier."""

    def predict_proba(self, X):
        p = np.clip(0.95 - X["d_now"].to_numpy() / 8 + 0.03 * X["horizon"].to_numpy(), 0, 1)
        return np.column_stack([1 - p, p])


def west_wind(day, tlat, tlon, speed=8.0):
    """POWER rows with wind blowing from the west (towards the east)."""
    return {(tlat, tlon): [{"date": d.strftime("%Y-%m-%d"), "precip_mm": 0.0, "temp_max_c": 28.0, "wind_ms": speed,
                            "wind_from_deg": 270.0, "humidity_pct": 30.0}
                           for d in pd.date_range(pd.Timestamp(day) - pd.Timedelta(days=5), day)]}


def test_square_codes_round_trip_west_of_greenwich():
    i, j = spread.cell_index([50.011, 45.0], [-74.049, -60.0])
    back = spread.decode(spread.code(i, j))
    assert (back[0] == i).all() and (back[1] == j).all()
    lat, lon = spread.centre(i, j)
    assert abs(lat[0] - 50.01) < 0.011 and abs(lon[0] - (-74.055)) < 0.016


def test_burning_cells_counts_detections_per_square_and_day():
    c = spread.burning_cells(fires([("2023-06-01", 50.001, -74.001, 3.0), ("2023-06-01", 50.002, -74.002, 4.0),
                                    ("2023-06-02", 50.001, -74.001)]))
    assert len(c) == 2 and c.iloc[0]["n"] == 2 and c.iloc[0]["frp"] == 7.0


def test_candidates_stay_within_reach():
    active = spread.code(*spread.cell_index([50.0], [-74.0]))
    cand = spread.candidates(active)
    lat, lon = spread.centre(*spread.decode(cand))
    d = spread._km(50.01, -73.985, lat, lon)
    assert active[0] in cand and d.max() <= spread.REACH_KM + 2.5 and d.max() > spread.REACH_KM - 3


def test_features_use_only_the_past_and_wind_direction():
    f = fires([("2023-06-01", 50.0, -74.0), ("2023-06-02", 50.0, -74.0), ("2023-06-03", 50.0, -73.0)])
    days = spread.Days(spread.burning_cells(f))
    tl, tn = spread.tile_of([50.0], [-74.0])
    w = spread.weather_frame(west_wind("2023-06-02", float(tl[0]), float(tn[0])))
    here = spread.code(*spread.cell_index([50.0], [-74.0]))[0]
    east = spread.code(*spread.cell_index([50.0], [-73.9]))[0]
    west = spread.code(*spread.cell_index([50.0], [-74.1]))[0]
    out = spread.features(days, "2023-06-02", np.array([here, east, west]), w).set_index("code")
    assert out.loc[here, "d_now"] == 0 and out.loc[here, "self_now"] == 1 and out.loc[here, "self_prev"] == 1
    assert out.loc[here, "n_3"] == 1
    assert out.loc[east, "downwind"] > 7 and out.loc[west, "downwind"] < -7      # wind blows from the west
    assert out.loc[here, "downwind"] == 0
    assert out.loc[east, "d_now"] == pytest.approx(6.4, abs=0.2)      # square centres are 0.09 degrees apart
    # the fire on 3 June is in the future: not seen
    assert out.loc[east, "n_20"] == 1


def test_labels_look_ahead_by_horizon():
    f = fires([("2023-06-01", 50.0, -74.0), ("2023-06-03", 50.0, -73.9)])
    days = spread.Days(spread.burning_cells(f))
    east = spread.code(*spread.cell_index([50.0], [-73.9]))
    assert spread.labels(days, "2023-06-01", east, 1)[0] == 0
    assert spread.labels(days, "2023-06-01", east, 2)[0] == 1


def test_weather_falls_back_to_the_day_before():
    w = spread.weather_frame(west_wind("2023-06-01", 50.0, -74.375))
    key = spread.tile_key(*spread.tile_of([50.1], [-74.3]))
    got = spread.weather_at(w, key, pd.Timestamp("2023-06-03"))
    assert got.iloc[0]["wind_ms"] == 8.0
    assert np.isnan(spread.weather_at(w, key, pd.Timestamp("2023-07-01")).iloc[0]["wind_ms"])


def test_forecast_squares_place_and_reasons():
    f = fires([("2023-06-01", 50.0, -74.0), ("2023-06-02", 50.0, -74.0), ("2023-06-02", 50.02, -74.0)])
    tl, tn = spread.tile_of([50.0], [-74.0])
    w = spread.weather_frame(west_wind("2023-06-02", float(tl[0]), float(tn[0])))
    out = spread.forecast(ByDistance(), f, date(2023, 6, 2), w, days_ahead=3, lat=50.0, lon=-73.95, radius_km=50)
    assert out["as_of"] == "2023-06-02" and len(out["burning"]) == 2
    assert all(len(c["p"]) == 3 and c["p"] == sorted(c["p"]) for c in out["cells"])
    assert out["place"]["nearest_fire_from"] == "west" and out["place"]["warning_by_day"] == 1
    assert any("from the west" in r for r in out["reasons"])


def test_forecast_with_no_fire_in_the_circle():
    f = fires([("2023-06-02", 55.0, -70.0)])
    out = spread.forecast(ByDistance(), f, date(2023, 6, 2), None, lat=50.0, lon=-74.0, radius_km=50)
    assert out["cells"] == [] and "nothing to spread" in out["reasons"][0]


@pytest.mark.parametrize("deg,name", [(0, "north"), (44, "north-east"), (180, "south"), (350, "north"), (270, "west")])
def test_compass(deg, name):
    assert spread._compass(deg) == name


class WindAware(ByDistance):
    """Stands in for the forecast model: squares the forecast wind blows towards are likelier."""

    def predict_proba(self, X):
        assert "ahead_downwind" in X.columns
        p = np.clip(0.5 + X["ahead_downwind"].fillna(0).to_numpy() / 20 - X["d_now"].to_numpy() / 40, 0, 1)
        return np.column_stack([1 - p, p])


def east_wind_ahead(day, tlat, tlon, days=3):
    """Forecast rows for the days after `day`, with wind blowing from the east (towards the west)."""
    rows = [{"date": (pd.Timestamp(day) + pd.Timedelta(days=k)).strftime("%Y-%m-%d"), "precip_mm": 1.0,
             "temp_max_c": 20.0 + k, "wind_ms": 10.0, "wind_from_deg": 90.0, "humidity_pct": 40.0}
            for k in range(1, days + 1)]
    return spread.weather_frame({(tlat, tlon): rows})


def test_add_ahead_summarises_the_coming_days():
    f = fires([("2023-06-02", 50.0, -74.0)])
    days = spread.Days(spread.burning_cells(f))
    tl, tn = spread.tile_of([50.0], [-74.0])
    west = spread.code(*spread.cell_index([50.0], [-74.1]))[0]
    here = spread.code(*spread.cell_index([50.0], [-74.0]))[0]
    base = spread.features(days, "2023-06-02", np.array([west, here]), None).set_index("code")
    ahead = east_wind_ahead("2023-06-02", float(tl[0]), float(tn[0]))
    g = spread.add_ahead(base, ahead, "2023-06-02", 2)
    assert g.loc[west, "ahead_downwind"] == pytest.approx(10.0, abs=0.1)        # blowing towards the west square
    assert g.loc[here, "ahead_downwind"] == 0 and g.loc[west, "ahead_rain"] == 2.0
    assert g.loc[west, "ahead_temp_max"] == 22.0
    # by lead: the value for day k comes from the frame for lead k
    by_lead = {1: ahead, 2: spread.weather_frame({})}
    g2 = spread.add_ahead(base, by_lead, "2023-06-02", 2)
    assert g2.loc[west, "ahead_rain"] == 1.0


def test_forecast_uses_the_forecast_model_when_there_is_a_forecast():
    f = fires([("2023-06-02", 50.0, -74.0)])
    tl, tn = spread.tile_of([50.0], [-74.0])
    today = spread.weather_frame(west_wind("2023-06-02", float(tl[0]), float(tn[0])))
    ahead = east_wind_ahead("2023-06-02", float(tl[0]), float(tn[0]), days=2)
    out = spread.forecast(ByDistance(), f, date(2023, 6, 2), today, days_ahead=3, lat=50.0, lon=-74.0, radius_km=50,
                          forecast_model=WindAware(), ahead=ahead, ahead_source="test model")
    assert out["weather_used"] == ["forecast", "forecast", "today"]               # no forecast for day 3
    assert any(r.startswith("Forecast wind at the fire (test model): 3 Jun 36 km/h from the east") for r in out["reasons"])
    cells = pd.DataFrame(out["cells"])
    west = cells[(cells.lon < -74.05) & (cells.lat.between(49.99, 50.03))]["p"].str[0].max()
    east = cells[(cells.lon > -73.95) & (cells.lat.between(49.99, 50.03))]["p"].str[0].max()
    assert west > east


def test_forecast_without_forecast_weather_falls_back():
    f = fires([("2023-06-02", 50.0, -74.0)])
    out = spread.forecast(ByDistance(), f, date(2023, 6, 2), None, days_ahead=2, lat=50.0, lon=-74.0, radius_km=50,
                          forecast_model=WindAware(), ahead=spread.weather_frame({}))
    assert out["weather_used"] == ["today", "today"]
