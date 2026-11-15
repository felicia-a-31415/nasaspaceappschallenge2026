"""Web server: answers "what burned within this circle between these months?"

Circles in Quebec are answered at once from the preloaded tables. Anywhere
else is fetched from NASA FIRMS on demand (see server/ondemand.py).

Run with:  uvicorn server.app:app --port 8000
"""
import calendar
import gzip
import json
import os
import pickle
import re
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from harmonize.borders import BOX, coverage
from harmonize.query import RADII_KM, circle_monthly, monthly_csv, summarize
from harmonize.schema import clean
from server.ondemand import Places, _circle_fits, box_for
from server import forecast, outlook, spread, stats, weather
from server.store import empty_hotspots, hotspots_in_circle, load_region

MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CHARTS = ("before", "after", "validation")
MAX_HOTSPOT_ROWS = 500_000
CSV_CHUNK = 50_000
TOO_FAR = "Fire history is not available this far north or south."
NOTHING_YET = "There is no fire history for this place yet."
NO_WEATHER = "NASA's weather service did not answer. Try again in a moment."
WEATHER_DEFAULT_MONTHS = 12
SPREAD_MAX_TILES = 40
NO_SPREAD_MODEL = "The spread model is missing. Run: python -m harmonize.spread_train"


class Selection:
    """A validated circle and month range. Raises 422 with a plain sentence."""

    def __init__(self, lat, lon, radius_km, start, end):
        if not -90 <= lat <= 90 or not -180 <= lon <= 180:
            raise HTTPException(422, "That place is not on the map. Latitude runs from -90 to 90 and longitude from -180 to 180.")
        if radius_km not in RADII_KM:
            raise HTTPException(422, f"The radius must be one of {', '.join(str(r) for r in RADII_KM)} km.")
        check_months(start, end)
        self.lat, self.lon, self.radius_km, self.start, self.end = lat, lon, radius_km, start, end

    def file_name(self, what):
        return f"{what}-{self.lat:.2f}_{self.lon:.2f}_{self.radius_km}km.csv"


def month_range(table, sel):
    """The asked-for months, defaulting to everything the table has."""
    return pd.Period(sel.start or table.data_start, "M"), pd.Period(sel.end or table.data_end, "M")


def monthly_for(table, sel):
    """(months in the range, months over the whole data period) for a selection.

    Both the JSON answer and the CSV download come from here, so they cannot disagree.
    """
    full = circle_monthly(table.cd, table.curve(sel.radius_km), sel.lat, sel.lon, sel.radius_km,
                          table.data_start, table.data_end, table.data_start, table.data_end)
    start, end = month_range(table, sel)
    return full.loc[start:end], full, start, end


def answer(table, sel, coverage_label, progress=None):
    months, full, start, end = monthly_for(table, sel)
    rows = [{"month": str(month), "activity": round(float(r.activity), 1), "low": round(float(r.low), 1),
             "high": round(float(r.high), 1), "estimated": bool(r.estimated),
             "terra_only": bool(r.terra_only), "median": round(float(r.median), 1)}
            for month, r in zip(months.index, months.itertuples())]
    return {"coverage": coverage_label, "progress": progress, "curve_source": table.curve_source,
            "data_through": table.data_through, "months": rows,
            "summary": summarize(full, start, end, table.data_through) if len(months) else None, "detail": None}


def empty_answer(coverage_label, detail=None, progress=None):
    return {"coverage": coverage_label, "progress": progress, "curve_source": None, "data_through": None,
            "months": [], "summary": None, "detail": detail}


def check_months(start, end):
    for label, value in (("from", start), ("to", end)):
        if value is not None and not MONTH.match(value):
            raise HTTPException(422, f"The '{label}' month must look like 2023-06.")
    if start and end and start > end:
        raise HTTPException(422, "The 'from' month is after the 'to' month.")


def viirs_only(hotspots):
    """VIIRS vegetation fires from both satellites, as the spread model was trained on."""
    rows = clean(hotspots)
    rows = rows[rows["sensor"].astype(str) == "VIIRS"]
    return rows[["latitude", "longitude", "acq_date", "frp"]].reset_index(drop=True)


def create_app(data_dir, cache_dir, places=None, weather_daily=weather.daily, web_dir="web/dist", spread_model=None,
               forecast_daily=forecast.as_issued):
    """`places`, `weather_daily`, `spread_model` and `forecast_daily` are injected by tests; left out, the app builds its own
    places and runs its fetch worker, and loads the spread model from `data_dir`."""
    data_dir = Path(data_dir)
    region = load_region(data_dir)
    own_worker = places is None
    if places is None:
        places = Places(cache_dir, region.model, curve_source=region.curve_source)

    @asynccontextmanager
    async def lifespan(app):
        if own_worker:
            places.start()
        yield
        places.stop()

    app = FastAPI(title="Fire calendar", lifespan=lifespan)
    app.add_middleware(GZipMiddleware, minimum_size=10_000)
    app.state.region = region
    app.state.places = places

    @lru_cache(maxsize=1)
    def region_hotspots():
        """Quebec's fire hotspots from the camera in use at the time, loaded on first use."""
        if region.hotspots_path is None:
            raise HTTPException(404, "The hotspot table is missing. Run: python -m harmonize.run")
        return stats.in_use(pd.read_parquet(region.hotspots_path))

    @lru_cache(maxsize=1)
    def region_dots():
        return stats.dots_json(region_hotspots(), region.curve_source, region.data_through, BOX)

    @lru_cache(maxsize=1)
    def region_dots_gzip():
        return gzip.compress(region_dots(), compresslevel=6)       # compressed once, not on every page load

    cached_weather = lru_cache(maxsize=1024)(weather_daily)

    @lru_cache(maxsize=1)
    def region_viirs():
        if region.hotspots_path is None:
            raise HTTPException(404, "The hotspot table is missing. Run: python -m harmonize.run")
        return viirs_only(pd.read_parquet(region.hotspots_path))

    @lru_cache(maxsize=1)
    def spread_bundle():
        if spread_model is not None:
            return spread_model
        path = data_dir / "spread_model.pkl"
        if not path.exists():
            raise HTTPException(404, NO_SPREAD_MODEL)
        with open(path, "rb") as fh:
            bundle = pickle.load(fh)
        checks = data_dir / "spread_validation.json"
        bundle["tested"] = spread_tested(json.loads(checks.read_text())) if checks.exists() else None
        return bundle

    cached_forecast = lru_cache(maxsize=512)(forecast_daily)

    def tile_forecasts(tiles, issue, days):
        """What was forecast on `issue` for the days after, per weather grid point, as add_ahead takes it."""
        def one(t):
            try:
                return t, cached_forecast(t[0], t[1], issue, days)
            except forecast.ForecastError:
                return t, None
        with ThreadPoolExecutor(8) as pool:
            got = {t: rows for t, rows in pool.map(one, tiles) if rows}
        if not got:
            return None
        if all(isinstance(rows, dict) for rows in got.values()):
            return {k: spread.weather_frame({t: rows.get(k, []) for t, rows in got.items()}) for k in range(1, days + 1)}
        return spread.weather_frame({t: rows for t, rows in got.items() if isinstance(rows, list)})

    def tile_weather(tiles, first, last):
        """NASA POWER rows for each weather grid point, fetched side by side; a point that fails is left out."""
        def one(t):
            try:
                return t, cached_weather(t[0], t[1], first, last)
            except weather.WeatherError:
                return t, []
        with ThreadPoolExecutor(8) as pool:
            return dict(pool.map(one, tiles))

    @app.exception_handler(RequestValidationError)
    async def plain_validation_error(request: Request, exc: RequestValidationError):
        fields = ", ".join(str(e["loc"][-1]) for e in exc.errors())
        return JSONResponse({"detail": f"These values are missing or not understood: {fields}."}, status_code=422)

    def table_for(sel):
        """(table, coverage, progress, detail). `table` is None when there is nothing to answer from yet.

        coverage: 'preloaded' or 'partial' in the preloaded region; elsewhere the
        place's fetch status ('queued', 'fetching', 'fetched'), or 'outside' when
        no answer is possible (too far north or south, or the fetch failed).
        """
        where = coverage(sel.lat, sel.lon, sel.radius_km)
        if where != "outside":
            return region, "preloaded" if where == "inside" else "partial", None, None
        if box_for(sel.lat, sel.lon) is None:
            return None, "outside", None, TOO_FAR
        state = places.request(sel.lat, sel.lon, sel.radius_km)
        if state.status == "failed":
            return None, "outside", None, state.error
        label = state.status
        if label == "fetched" and not _circle_fits(state.box, sel.lat, sel.lon, sel.radius_km):
            label = "partial"           # the box stops at 180 degrees longitude; part of the circle is left out
        return places.table(state), label, state.progress(), None

    @app.get("/api/activity")
    def activity(lat: float, lon: float, radius_km: int = 100,
                 start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to")):
        sel = Selection(lat, lon, radius_km, start, end)
        table, where, progress, detail = table_for(sel)
        if table is None:
            return empty_answer(where, detail, progress)
        return answer(table, sel, where, progress)

    @app.get("/api/download/monthly.csv")
    def download_monthly(lat: float, lon: float, radius_km: int = 100,
                         start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to")):
        sel = Selection(lat, lon, radius_km, start, end)
        table, _, _, detail = table_for(sel)
        if table is None:
            raise HTTPException(404, detail or NOTHING_YET)
        months = monthly_for(table, sel)[0]
        return Response(monthly_csv(months), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{sel.file_name("fire")}"'})

    @app.get("/api/download/hotspots.csv")
    def download_hotspots(lat: float, lon: float, radius_km: int = 100,
                          start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to")):
        sel = Selection(lat, lon, radius_km, start, end)
        table, _, _, detail = table_for(sel)
        rows = None if table is None else hotspots_in_circle(table, sel.lat, sel.lon, sel.radius_km,
                                                             *month_range(table, sel))
        if rows is None:
            raise HTTPException(404, detail or NOTHING_YET)
        if len(rows) > MAX_HOTSPOT_ROWS:
            raise HTTPException(422, "That is too many hotspots to download at once. Choose a smaller radius or a shorter period.")

        def chunks():
            yield ",".join(rows.columns) + "\n"
            for at in range(0, len(rows), CSV_CHUNK):
                yield rows.iloc[at:at + CSV_CHUNK].to_csv(index=False, header=False, date_format="%Y-%m-%d")

        return StreamingResponse(chunks(), media_type="text/csv",
                                 headers={"Content-Disposition": f'attachment; filename="{sel.file_name("hotspots")}"'})

    @app.get("/api/hotspots")
    def hotspots(request: Request, region_name: str = Query("quebec", alias="region")):
        if region_name != region.curve_source:
            raise HTTPException(404, f"Only '{region.curve_source}' is available.")
        if "gzip" in request.headers.get("accept-encoding", "").lower():
            return Response(region_dots_gzip(), media_type="application/json",
                            headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
        return Response(region_dots(), media_type="application/json", headers={"Vary": "Accept-Encoding"})

    @app.get("/api/stats")
    def circle_stats(lat: float, lon: float, radius_km: int = 100,
                     start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to")):
        sel = Selection(lat, lon, radius_km, start, end)
        table, where, _, detail = table_for(sel)
        if table is None:
            return {"coverage": where, "detail": detail, "detections": 0, "mean_frp": None, "sum_frp": 0.0,
                    "peak_day": None, "by_year": [], "typical_year": None, "this_year": None}
        if table is region:
            rows = stats.in_circle(region_hotspots(), sel.lat, sel.lon, sel.radius_km)
        else:
            rows = stats.in_use(hotspots_in_circle(table, sel.lat, sel.lon, sel.radius_km,
                                                   table.data_start, table.data_end))
        first, last = month_range(table, sel)
        first, last = max(first, table.data_start), min(last, table.data_end)
        return {"coverage": where, "detail": None, **stats.circle_stats(rows, first, last, table.data_through, table.data_start)}

    @app.get("/api/top-areas")
    def top_areas(start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to"),
                  limit: int = 10):
        check_months(start, end)
        if not 1 <= limit <= 100:
            raise HTTPException(422, "The limit must be between 1 and 100.")
        first = pd.Period(start or region.data_start, "M")
        last = pd.Period(end or region.data_end, "M")
        return {"areas": stats.top_areas(region_hotspots(), first, last, limit)}

    @app.get("/api/weather")
    def weather_at(lat: float, lon: float,
                   start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to")):
        Selection(lat, lon, RADII_KM[0], start, end)
        last = pd.Period(end or region.data_end, "M")
        first = pd.Period(start, "M") if start else last - (WEATHER_DEFAULT_MONTHS - 1)
        if first > last:
            raise HTTPException(422, "The 'from' month is after the 'to' month.")
        if first.year < 1981:
            raise HTTPException(422, "Weather records start in 1981.")
        first_day = date(first.year, first.month, 1)
        last_day = min(date(last.year, last.month, calendar.monthrange(last.year, last.month)[1]), date.today())
        if first_day > last_day:
            return {"source": "NASA POWER", "days": []}
        try:
            days = cached_weather(round(lat, 2), round(lon, 2), first_day, last_day)
        except weather.WeatherError:
            raise HTTPException(502, NO_WEATHER) from None
        return {"source": "NASA POWER", "days": days}

    @app.get("/api/outlook")
    def risk_outlook(lat: float, lon: float, radius_km: int = 100, on: str | None = None):
        sel = Selection(lat, lon, radius_km, None, None)
        if on is not None and not DAY.match(on):
            raise HTTPException(422, "The 'on' day must look like 2023-06-01.")
        table, where, _, detail = table_for(sel)
        if table is None or not len(table.cd):
            return {"coverage": where, "detail": detail or NOTHING_YET, **outlook.empty(date.today())}
        try:
            day = date.fromisoformat(on or table.data_through)
        except ValueError:
            raise HTTPException(422, "The 'on' day must be a real date, like 2023-06-01.") from None
        if day > date.fromisoformat(table.data_through):
            raise HTTPException(422, f"The outlook can only be asked for a day up to {table.data_through}, "
                                     "the last day with fire records.")
        try:
            days = cached_weather(round(lat, 2), round(lon, 2), outlook.WEATHER_START, day)
        except weather.WeatherError:
            days = None
        body = outlook.outlook(table.cd, sel.lat, sel.lon, sel.radius_km, day, days, table.data_start.start_time.date())
        return {"coverage": where, "detail": None, **body}

    @app.get("/api/spread")
    def spread_forecast(lat: float, lon: float, radius_km: int = 50, on: str | None = None, days: int = 3):
        sel = Selection(lat, lon, radius_km, None, None)
        if on is not None and not DAY.match(on):
            raise HTTPException(422, "The 'on' day must look like 2023-06-01.")
        if not 1 <= days <= spread.MAX_DAYS:
            raise HTTPException(422, f"'days' must be from 1 to {spread.MAX_DAYS}.")
        bundle = spread_bundle()
        table, where, _, detail = table_for(sel)
        if table is None:
            return {"coverage": where, "detail": detail or NOTHING_YET, "label": spread.SPREAD_LABEL}
        try:
            day = date.fromisoformat(on or table.data_through)
        except ValueError:
            raise HTTPException(422, "The 'on' day must be a real date, like 2023-06-01.") from None
        if day > date.fromisoformat(table.data_through):
            raise HTTPException(422, f"The forecast can only start from a day up to {table.data_through}, "
                                     "the last day with fire records.")
        if day < spread.FIRST_DAY:
            raise HTTPException(422, f"The forecast needs VIIRS, which starts on {spread.FIRST_DAY.isoformat()}.")
        first = pd.Timestamp(day - timedelta(days=spread.LOOKBACK_DAYS + 3))
        reach = sel.radius_km + spread.REACH_KM + 5
        if table is region:
            fires = stats.in_circle(region_viirs(), sel.lat, sel.lon, reach)
        else:
            raw = hotspots_in_circle(table, sel.lat, sel.lon, reach, first.to_period("M"), pd.Period(day, "M"))
            fires = viirs_only(raw) if raw is not None and len(raw) else viirs_only(empty_hotspots())
        fires = fires[(fires["acq_date"] >= first) & (fires["acq_date"] <= pd.Timestamp(day))]
        today = fires[fires["acq_date"] == pd.Timestamp(day)]
        tl, tn = spread.tile_of(today["latitude"].to_numpy(), today["longitude"].to_numpy())
        tiles = sorted(set(zip(tl.tolist(), tn.tolist())))[:SPREAD_MAX_TILES]
        w = spread.weather_frame(tile_weather(tiles, day - timedelta(days=5), day))
        ahead = tile_forecasts(tiles, day, days) if bundle.get("forecast_model") is not None else None
        body = spread.forecast(bundle["model"], fires, day, w, days, sel.lat, sel.lon, sel.radius_km,
                               forecast_model=bundle.get("forecast_model"), ahead=ahead,
                               ahead_source=bundle.get("forecast_source"))
        return {"coverage": where, "detail": None, **body, "tested": bundle.get("tested")}

    @app.get("/api/about")
    def about():
        def rows(name):
            path = data_dir / name
            return pd.read_csv(path).to_dict("records") if path.exists() else []
        return {"region": region.curve_source, "model": region.model, "validation": rows("validation.csv"),
                "circle_validation": rows("circle_validation.csv"),
                "data_through": region.data_through, "radii_km": list(RADII_KM)}

    @app.get("/api/charts/{name}.png")
    def chart(name: str):
        path = data_dir / f"{name}.png"
        if name not in CHARTS or not path.exists():
            raise HTTPException(404, "No such chart.")
        return FileResponse(path, media_type="image/png")

    if web_dir and Path(web_dir).is_dir():          # the built page, when there is one; after the /api routes
        app.mount("/", StaticFiles(directory=web_dir, html=True), name="web")

    return app


def spread_tested(report):
    """The held-out season's scores in a few numbers the page can quote."""
    held = report.get("served_model_held_out")
    season = next((r for r in report.get("seasons", []) if r["season"] == held), None)
    if season is None:
        return None
    out = {"season": held, "by_day": {}}
    for h, row in season["by_horizon"].items():
        m, b = row["model"], row["distance_only"]
        out["by_day"][h] = {"caught_share": m["new_at_0.5"]["caught_share"], "flag_precision": m["new_at_0.5"]["flag_precision"],
                            "avg_precision": m["new_squares"]["avg_precision"] if m["new_squares"] else None,
                            "baseline_avg_precision": b["new_squares"]["avg_precision"] if b["new_squares"] else None}
    out["zones"] = report.get("zones")
    test = report.get("forecast_test")
    if test:
        out["forecast"] = {"window": test["window"], "source": test["source"],
                           "by_day": {h: {name: row[name]["avg_precision"]
                                          for name in ("today_weather", "archived_forecast", "perfect_forecast")}
                                      for h, row in test["by_horizon"].items()}}
    return out


def _default_app():
    return create_app(os.environ.get("FIRE_DATA_DIR", "outputs/quebec"), os.environ.get("FIRE_CACHE_DIR", "cache"))


def __getattr__(name):          # build the real app only when uvicorn asks for it, not on import in tests
    if name == "app":
        globals()["app"] = _default_app()
        return globals()["app"]
    raise AttributeError(name)
