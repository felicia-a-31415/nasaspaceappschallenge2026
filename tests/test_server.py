import csv
import io
import json

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from tests.test_ondemand import FakeFetch, make_places

HERE = {"lat": 50.05, "lon": -74.0, "radius_km": 100}


def make_region(folder):
    """A small Quebec-like region: MODIS fire in 2005, VIIRS fire in 2015, near (50, -74)."""
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
    spots = [("2015-07-01", "1700", 50.02, -74.02, "VIIRS"), ("2015-07-01", "0600", 50.03, -74.01, "MODIS"),
             ("2015-12-10", "1700", 50.01, -74.05, "VIIRS"), ("2016-01-05", "1700", 50.02, -74.02, "VIIRS"),
             ("2015-07-01", "1700", 53.00, -74.00, "VIIRS")]                      # the last one is 330 km north
    spots += [("2005-07-01", "1700", 50.02, -74.02, "MODIS"), ("2005-07-01", "1710", 50.03, -74.02, "MODIS"),
              ("2005-07-02", "1700", 50.12, -74.02, "MODIS"), ("2014-08-03", "1700", 50.31, -74.02, "VIIRS"),
              ("2026-06-01", "1700", 50.02, -74.02, "VIIRS")]
    pd.DataFrame(spots, columns=["acq_date", "acq_time", "latitude", "longitude", "sensor"]) \
        .assign(acq_date=lambda d: pd.to_datetime(d["acq_date"]), likely_static=False, type_missing=False,
                type=pd.array([0] * len(spots), dtype="Int64"), frp=[float(i + 1) for i in range(len(spots))],
                dataset=lambda d: d["sensor"].map({"MODIS": "modis", "VIIRS": "viirs_snpp"})) \
        .sort_values("latitude").to_parquet(folder / "hotspots.parquet", index=False)
    return folder


@pytest.fixture
def places(tmp_path):
    return make_places(tmp_path, FakeFetch())


def fake_weather(lat, lon, start, end):
    fake_weather.calls.append((lat, lon, start, end))
    return [{"date": start.isoformat(), "precip_mm": 0.0, "temp_max_c": 31.2, "wind_ms": 4.1, "humidity_pct": None}]


@pytest.fixture
def client(tmp_path, places):
    fake_weather.calls = []
    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "index.html").write_text("<h1>the page</h1>")
    return TestClient(create_app(make_region(tmp_path / "quebec"), tmp_path / "cache", places=places,
                                 weather_daily=fake_weather, web_dir=tmp_path / "web"))


def test_activity_in_quebec(client):
    r = client.get("/api/activity", params=HERE | {"from": "2005-01", "to": "2015-12"})
    body = r.json()
    assert r.status_code == 200 and body["coverage"] == "preloaded" and body["progress"] is None
    assert body["curve_source"] == "quebec" and body["data_through"] == "2015-12-10"
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


SACRAMENTO = {"lat": 38.5, "lon": -121.5, "radius_km": 100}


def test_outside_quebec_starts_a_fetch_and_reports_progress(client, places):
    body = client.get("/api/activity", params=SACRAMENTO).json()
    assert body["coverage"] == "queued" and body["months"] == [] and body["summary"] is None
    assert body["progress"] == {"years_done": 0, "years_total": 27, "queue_position": 0}
    assert client.get("/api/download/monthly.csv", params=SACRAMENTO).status_code == 404   # nothing to download yet

    places.run_one_step()
    body = client.get("/api/activity", params=SACRAMENTO).json()
    assert body["coverage"] == "fetching" and body["progress"]["years_done"] == 1
    assert body["curve_source"] == "quebec" and body["summary"] is None                  # too few years to compare
    assert [m["month"] for m in body["months"]][0] == "2026-01" and body["months"][0]["activity"] == 1
    assert len(places.queue) == 1                                                         # asking again did not queue it twice

    while places.run_one_step():
        pass
    body = client.get("/api/activity", params=SACRAMENTO).json()
    assert body["coverage"] == "fetched" and body["months"][0]["month"] == "2000-11"
    assert body["summary"]["years_compared"] >= 5 and isinstance(body["summary"]["sentence"], str)
    assert client.get("/api/download/monthly.csv", params=SACRAMENTO).text.startswith("month,activity")


def test_just_across_the_border_is_fetched_not_answered_from_quebec(client):
    assert client.get("/api/activity", params={"lat": 45.4, "lon": -75.7, "radius_km": 50}).json()["coverage"] == "queued"   # Ottawa


def test_too_far_north_is_a_polite_no(client, places):                                    # Review Focus 3
    body = client.get("/api/activity", params={"lat": 82.0, "lon": 20.0, "radius_km": 100}).json()
    assert body["coverage"] == "outside" and "not available" in body["detail"] and not places.queue


def test_failed_fetch_is_reported_in_plain_words(client, places):                         # Review Focus 2
    from harmonize.firms import FirmsError
    places.fetch.raise_always(FirmsError("boom"))
    client.get("/api/activity", params=SACRAMENTO)
    places.run_one_step(retry_sleep=lambda s: None)
    body = client.get("/api/activity", params=SACRAMENTO).json()
    assert body["coverage"] == "outside" and "did not answer" in body["detail"] and "boom" not in body["detail"]


def test_hotspots_csv_is_only_the_circle_and_range(client):
    r = client.get("/api/download/hotspots.csv", params=HERE | {"radius_km": 50, "from": "2015-01", "to": "2015-12"})
    assert "attachment" in r.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert len(rows) == 3 and all(row["acq_date"].startswith("2015") for row in rows)   # raw: both cameras
    assert {"sensor", "likely_static", "latitude"} <= set(rows[0]) and {row["sensor"] for row in rows} == {"MODIS", "VIIRS"}
    assert [row["acq_date"] for row in rows] == ["2015-07-01", "2015-07-01", "2015-12-10"]


def test_hotspots_csv_with_nothing_in_range_is_just_the_header(client):
    r = client.get("/api/download/hotspots.csv", params=HERE | {"from": "2010-01", "to": "2010-12"})
    assert r.status_code == 200 and r.text.strip().startswith("acq_date") and len(r.text.strip().splitlines()) == 1


def test_too_many_hotspots_is_a_clear_no(client, monkeypatch):
    monkeypatch.setattr("server.app.MAX_HOTSPOT_ROWS", 2)
    r = client.get("/api/download/hotspots.csv", params=HERE)
    assert r.status_code == 422 and "too many hotspots" in r.json()["detail"]


def test_hotspots_csv_for_a_fetched_place(client, places):
    client.get("/api/activity", params=SACRAMENTO)
    while places.run_one_step():
        pass
    rows = list(csv.DictReader(io.StringIO(client.get("/api/download/hotspots.csv", params=SACRAMENTO | {"from": "2012-01", "to": "2012-12"}).text)))
    assert sorted((row["acq_date"], row["sensor"]) for row in rows) == [("2012-01-20", "VIIRS")]   # the fake has one hotspot per fetch
    assert "likely_static" in rows[0]


def test_about_and_charts(client):
    about = client.get("/api/about").json()
    assert about["radii_km"] == [50, 100, 200] and about["data_through"] == "2015-12-10"
    assert about["validation"][0]["year"] == 2012 and about["circle_validation"][0]["radius_km"] == 100
    assert about["model"]["a"] == 1.0 and about["region"] == "quebec"
    assert client.get("/api/charts/before.png").status_code == 200
    assert client.get("/api/charts/secrets.png").status_code == 404


def test_dots_use_one_camera_per_period(client):
    body = client.get("/api/hotspots", params={"region": "quebec"}).json()
    assert body["region"] == "quebec" and body["epoch"] == "2000-01-01" and len(body["bbox"]) == 4
    assert body["count"] == 9 == len(body["lon"]) == len(body["lat"]) == len(body["day"]) == len(body["frp"]) == len(body["sensor"])
    assert body["day"] == sorted(body["day"]) and body["day"][0] == (pd.Timestamp("2005-07-01") - pd.Timestamp("2000-01-01")).days
    assert body["sensor"] == [0, 0, 0, 1, 1, 1, 1, 1, 1]              # the 2015 MODIS hotspot is left out: VIIRS covers that year
    assert client.get("/api/hotspots", params={"region": "canada"}).status_code == 404


def test_stats_for_a_circle(client):
    body = client.get("/api/stats", params=HERE | {"from": "2005-01", "to": "2015-12"}).json()
    assert body["coverage"] == "preloaded" and body["detections"] == 6      # 3 in 2005, 1 in 2014, 2 in 2015; not the one 330 km north
    assert body["peak_day"] == {"date": "2005-07-01", "detections": 2}
    assert [y["year"] for y in body["by_year"]] == list(range(2005, 2016))
    by_year = {y["year"]: y for y in body["by_year"]}
    assert by_year[2005]["sensor"] == "MODIS" and by_year[2005]["detections"] == 3
    assert by_year[2015]["sensor"] == "VIIRS" and by_year[2015]["detections"] == 2 and by_year[2010]["mean_frp"] is None
    assert body["sum_frp"] == sum(y["sum_frp"] for y in body["by_year"])
    assert body["this_year"]["year"] == 2015 and body["this_year"]["detections"] == 2   # the fixture's data ends in 2015
    assert body["typical_year"] == {"detections": 0.5, "sum_frp": 4.5, "years": 2}      # median of 2013 (nothing) and 2014 (one), same camera


def test_stats_where_nothing_burned_is_calm(client):                                    # Review Focus 1
    body = client.get("/api/stats", params={"lat": 55.0, "lon": -70.0, "radius_km": 50}).json()
    assert body["detections"] == 0 and body["mean_frp"] is None and body["peak_day"] is None and body["sum_frp"] == 0


def test_stats_outside_quebec_follow_the_fetch(client, places):
    body = client.get("/api/stats", params=SACRAMENTO).json()
    assert body["coverage"] == "queued" and body["detections"] == 0 and body["by_year"] == []
    for _ in range(4):                                                                  # 2026, the NOAA-20 top-up, 2025, 2024
        places.run_one_step()
    body = client.get("/api/stats", params=SACRAMENTO).json()
    assert body["coverage"] == "fetching" and [y["year"] for y in body["by_year"]] == [2024, 2025, 2026]
    assert body["typical_year"]["years"] == 2                                           # only the years fetched so far


def test_stats_for_a_fetched_place_with_no_hotspots_nearby(client, places):
    client.get("/api/activity", params=SACRAMENTO)
    for _ in range(4):
        places.run_one_step()
    quiet = SACRAMENTO | {"lat": 41.5, "radius_km": 50}                                # same box, far from the fake's one hotspot
    r = client.get("/api/stats", params=quiet)
    assert r.status_code == 200 and r.json()["detections"] == 0 and r.json()["peak_day"] is None
    r = client.get("/api/download/hotspots.csv", params=quiet)
    assert r.status_code == 200 and len(r.text.strip().splitlines()) == 1


def test_circle_cut_off_at_180_degrees_is_partial(client, places):
    near_edge = {"lat": 0.0, "lon": 179.5, "radius_km": 200}
    client.get("/api/activity", params=near_edge)
    for state in places.places.values():
        state.status = "fetched"
    assert client.get("/api/activity", params=near_edge).json()["coverage"] == "partial"


def test_dots_are_sent_compressed_once(client):
    r = client.get("/api/hotspots", params={"region": "quebec"}, headers={"Accept-Encoding": "gzip"})
    assert r.headers["content-encoding"] == "gzip" and r.json()["count"] == 9       # decodes once: not gzipped twice
    plain = client.get("/api/hotspots", params={"region": "quebec"}, headers={"Accept-Encoding": "identity"})
    assert "content-encoding" not in plain.headers and plain.json()["count"] == 9


def test_top_areas_rank_within_one_camera(client):
    areas = client.get("/api/top-areas", params={"from": "2005-01", "to": "2015-12", "limit": 2}).json()["areas"]
    assert len(areas) == 2 and all(a["sensor"] == "VIIRS" for a in areas)             # range reaches VIIRS years: MODIS not mixed in
    assert areas[0]["sum_frp"] >= areas[1]["sum_frp"] and (areas[0]["lat"], areas[0]["lon"]) == (50.35, -74.05)
    early = client.get("/api/top-areas", params={"from": "2005-01", "to": "2005-12"}).json()["areas"]
    assert [a["sensor"] for a in early] == ["MODIS", "MODIS"] and early[0]["detections"] == 2
    assert client.get("/api/top-areas", params={"limit": 0}).status_code == 422


def test_weather_is_asked_once_per_place_and_range(client):
    params = {"lat": 49.9, "lon": -74.4, "from": "2023-06", "to": "2023-06"}
    body = client.get("/api/weather", params=params).json()
    assert body["source"] == "NASA POWER" and body["days"][0]["humidity_pct"] is None
    client.get("/api/weather", params=params)
    assert len(fake_weather.calls) == 1 and fake_weather.calls[0][2:] == (pd.Timestamp("2023-06-01").date(), pd.Timestamp("2023-06-30").date())
    assert client.get("/api/weather", params=params | {"from": "2024-01"}).status_code == 422


def test_weather_failure_is_a_plain_sentence(tmp_path, places):
    from server.weather import WeatherError
    def broken(*args):
        raise WeatherError("x")
    c = TestClient(create_app(make_region(tmp_path / "quebec"), tmp_path / "cache", places=places, weather_daily=broken))
    r = c.get("/api/weather", params={"lat": 49.9, "lon": -74.4, "from": "2023-06", "to": "2023-06"})
    assert r.status_code == 502 and "did not answer" in r.json()["detail"]


def test_built_page_is_served_without_hiding_the_api(client):
    assert "the page" in client.get("/").text
    assert client.get("/api/about").status_code == 200


def test_outlook_in_quebec_says_when_history_is_too_short(client):
    body = client.get("/api/outlook", params=HERE).json()
    assert body["coverage"] == "preloaded" and body["label"].startswith("Outlook from past seasons")
    assert body["as_of"] == "2015-12-10" and body["level"] is None and body["reasons"]   # VIIRS only from 2012: too few years
    assert fake_weather.calls[-1][3] == pd.Timestamp("2015-12-10").date()


@pytest.mark.parametrize("on", ["2015-13-01", "soon", "2016-01-01"])
def test_outlook_date_must_be_a_day_with_data(client, on):
    r = client.get("/api/outlook", params=HERE | {"on": on})
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)


def test_outlook_outside_quebec_waits_for_the_fetch(client):
    body = client.get("/api/outlook", params=SACRAMENTO).json()
    assert body["coverage"] == "queued" and body["level"] is None and body["detail"]


def test_outlook_survives_missing_weather(tmp_path, places):
    from server.weather import WeatherError
    def broken(*args):
        raise WeatherError("x")
    c = TestClient(create_app(make_region(tmp_path / "quebec"), tmp_path / "cache", places=places, weather_daily=broken))
    r = c.get("/api/outlook", params=HERE)
    assert r.status_code == 200 and r.json()["weather"] is None


def spread_client(tmp_path, places):
    from tests.test_spread import ByDistance
    fake_weather.calls = []
    return TestClient(create_app(make_region(tmp_path / "quebec"), tmp_path / "cache", places=places,
                                 weather_daily=fake_weather, spread_model={"model": ByDistance(), "tested": None}))


def test_spread_forecast_in_quebec(tmp_path, places):
    c = spread_client(tmp_path, places)
    body = c.get("/api/spread", params=HERE | {"radius_km": 50, "on": "2015-12-10", "days": 2}).json()
    assert body["coverage"] == "preloaded" and body["label"] == "Experimental spread forecast"
    assert body["as_of"] == "2015-12-10" and len(body["burning"]) == 1
    assert body["cells"] and all(len(cell["p"]) == 2 for cell in body["cells"])
    assert body["place"]["nearest_fire_km"] < 10
    assert fake_weather.calls and fake_weather.calls[-1][3] == pd.Timestamp("2015-12-10").date()


def test_spread_with_no_fire_that_day(tmp_path, places):
    body = spread_client(tmp_path, places).get("/api/spread", params=HERE | {"on": "2015-12-09"}).json()
    assert body["cells"] == [] and body["reasons"]


@pytest.mark.parametrize("params", [{"days": 0}, {"days": 8}, {"on": "soon"}, {"on": "2016-01-01"}, {"on": "2010-06-01"}])
def test_spread_rejects_bad_values(tmp_path, places, params):
    r = spread_client(tmp_path, places).get("/api/spread", params=HERE | params)
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)


def test_spread_without_a_model_says_how_to_make_one(client):
    r = client.get("/api/spread", params=HERE)
    assert r.status_code == 404 and "spread_train" in r.json()["detail"]


def test_spread_uses_the_forecast_when_the_model_has_one(tmp_path, places):
    from tests.test_spread import ByDistance, WindAware
    asked = []
    def fake_forecast(lat, lon, issue, days):
        asked.append((lat, lon, issue, days))
        return {k: [{"date": (pd.Timestamp(issue) + pd.Timedelta(days=k)).strftime("%Y-%m-%d"), "precip_mm": 0.0,
                     "temp_max_c": 25.0, "wind_ms": 6.0, "wind_from_deg": 90.0, "humidity_pct": 30.0}]
                for k in range(1, days + 1)}
    fake_weather.calls = []
    c = TestClient(create_app(make_region(tmp_path / "quebec"), tmp_path / "cache", places=places,
                              weather_daily=fake_weather, forecast_daily=fake_forecast,
                              spread_model={"model": ByDistance(), "forecast_model": WindAware(),
                                            "forecast_source": "fake", "tested": None}))
    body = c.get("/api/spread", params=HERE | {"radius_km": 50, "on": "2015-12-10", "days": 2}).json()
    assert body["weather_used"] == ["forecast", "forecast"] and asked[0][2:] == (pd.Timestamp("2015-12-10").date(), 2)
    assert any(r.startswith("Forecast wind at the fire (fake)") for r in body["reasons"])


def test_spread_survives_a_broken_forecast(tmp_path, places):
    from server.forecast import ForecastError
    from tests.test_spread import ByDistance, WindAware
    def broken(*args):
        raise ForecastError("x")
    c = TestClient(create_app(make_region(tmp_path / "quebec"), tmp_path / "cache", places=places,
                              weather_daily=fake_weather, forecast_daily=broken,
                              spread_model={"model": ByDistance(), "forecast_model": WindAware(), "tested": None}))
    body = c.get("/api/spread", params=HERE | {"radius_km": 50, "on": "2015-12-10", "days": 2}).json()
    assert body["weather_used"] == ["today", "today"]
