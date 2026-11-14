import csv
import io
import json

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from server.app import create_app

HERE = {"lat": 50.05, "lon": -74.0, "radius_km": 100}


def make_region(folder):
    """A small Canada-like region: MODIS fire in 2005, VIIRS fire in 2015, near (50, -74)."""
    folder.mkdir(parents=True)
    rows = [("2005-01-15", 50.0, -74.0, "MODIS"), ("2005-07-01", 50.0, -74.0, "MODIS"),
            ("2005-07-02", 50.1, -74.0, "MODIS"), ("2015-07-01", 50.0, -74.0, "VIIRS"),
            ("2015-07-01", 50.0, -74.0, "MODIS"), ("2015-12-10", 50.0, -74.1, "VIIRS")]
    cd = pd.DataFrame(rows, columns=["date", "cell_lat", "cell_lon", "sensor"])
    cd.assign(date=pd.to_datetime(cd["date"])).to_parquet(folder / "cell_days.parquet", index=False)
    curve = {"a": 1.0, "b": 1.0, "sigma": 0.5}
    (folder / "model.json").write_text(json.dumps({**curve, "by_radius": {"100": {"a": 0.5, "b": 1.0, "sigma": 0.5}}}))
    pd.DataFrame({"year": [2012], "err_curve": [5.0]}).to_csv(folder / "validation.csv", index=False)
    pd.DataFrame({"radius_km": [100], "median_err_curve": [21.0]}).to_csv(folder / "circle_validation.csv", index=False)
    (folder / "before.png").write_bytes(b"\x89PNG fake")
    return folder


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(make_region(tmp_path / "region"), tmp_path / "cache"))


def test_activity_in_canada(client):
    r = client.get("/api/activity", params=HERE | {"from": "2005-01", "to": "2015-12"})
    body = r.json()
    assert r.status_code == 200 and body["coverage"] == "canada" and body["progress"] is None
    assert body["curve_source"] == "canada" and body["data_through"] == "2015-12-10"
    assert len(body["months"]) == 132
    assert set(body["months"][0]) == {"month", "activity", "low", "high", "estimated", "terra_only", "median"}
    july = next(m for m in body["months"] if m["month"] == "2015-07")
    assert july["activity"] == 1 and july["estimated"] is False


def test_curve_for_the_chosen_radius_is_used(client):
    def july_2005(radius):
        months = client.get("/api/activity", params=HERE | {"radius_km": radius}).json()["months"]
        return next(m for m in months if m["month"] == "2005-07")["activity"]
    assert july_2005(100) < july_2005(200)      # 100 km has its own, lower curve; 200 km falls back to the region's


def test_csv_matches_json(client):
    months = client.get("/api/activity", params=HERE).json()["months"]
    r = client.get("/api/download/monthly.csv", params=HERE)
    assert "attachment" in r.headers["content-disposition"] and ".csv" in r.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert [row["month"] for row in rows] == [m["month"] for m in months]
    assert [float(row["activity"]) for row in rows] == [round(m["activity"], 1) for m in months]


@pytest.mark.parametrize("bad", [{"radius_km": 75}, {"lat": 95}, {"lon": 200}, {"from": "2020-13"},
                                 {"to": "soon"}, {"from": "2020-05", "to": "2019-01"}])
def test_bad_input_is_422_with_a_sentence(client, bad):            # Review Focus 5
    r = client.get("/api/activity", params=HERE | bad)
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)


def test_range_past_the_data_is_clipped(client):                   # Review Focus 5
    body = client.get("/api/activity", params=HERE | {"to": "2030-12"}).json()
    assert body["months"][-1]["month"] == "2015-12"


def test_range_entirely_outside_the_data_is_empty_not_an_error(client):
    body = client.get("/api/activity", params=HERE | {"from": "2028-01", "to": "2029-12"}).json()
    assert body["months"] == [] and body["summary"] is None


def test_partial_coverage_near_the_border(client):
    assert client.get("/api/activity", params={"lat": 45.5, "lon": -73.6, "radius_km": 100}).json()["coverage"] == "partial"


def test_outside_canada_placeholder(client):
    body = client.get("/api/activity", params={"lat": 38.5, "lon": -121.5, "radius_km": 100}).json()
    assert body["coverage"] == "outside" and body["months"] == [] and body["summary"] is None


def test_about_and_charts(client):
    about = client.get("/api/about").json()
    assert about["radii_km"] == [50, 100, 200] and about["data_through"] == "2015-12-10"
    assert about["validation"][0]["year"] == 2012 and about["circle_validation"][0]["radius_km"] == 100
    assert about["model"]["a"] == 1.0
    assert client.get("/api/charts/before.png").status_code == 200
    assert client.get("/api/charts/secrets.png").status_code == 404
