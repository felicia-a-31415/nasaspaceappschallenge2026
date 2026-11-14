"""Web server: answers "what burned within this circle between these months?"

Run with:  uvicorn server.app:app --port 8000
"""
import os
import re
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response

from harmonize.borders import coverage
from harmonize.query import RADII_KM, circle_monthly, monthly_csv, summarize
from server.store import load_region

MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
CHARTS = ("before", "after", "validation")


class Selection:
    """A validated circle and month range. Raises 422 with a plain sentence."""

    def __init__(self, lat, lon, radius_km, start, end):
        if not -90 <= lat <= 90 or not -180 <= lon <= 180:
            raise HTTPException(422, "That place is not on the map. Latitude runs from -90 to 90 and longitude from -180 to 180.")
        if radius_km not in RADII_KM:
            raise HTTPException(422, f"The radius must be one of {', '.join(str(r) for r in RADII_KM)} km.")
        for label, value in (("from", start), ("to", end)):
            if value is not None and not MONTH.match(value):
                raise HTTPException(422, f"The '{label}' month must look like 2023-06.")
        if start and end and start > end:
            raise HTTPException(422, "The 'from' month is after the 'to' month.")
        self.lat, self.lon, self.radius_km, self.start, self.end = lat, lon, radius_km, start, end


def selection(lat: float, lon: float, radius_km: int = 100,
              start: str | None = Query(None, alias="from"),
              end: str | None = Query(None, alias="to")) -> Selection:
    return Selection(lat, lon, radius_km, start, end)


def monthly_for(table, sel):
    """(months in the range, months over the whole data period) for a selection.

    Both the JSON answer and the CSV download come from here, so they cannot disagree.
    """
    full = circle_monthly(table.cd, table.curve(sel.radius_km), sel.lat, sel.lon, sel.radius_km,
                          table.data_start, table.data_end, table.data_start, table.data_end)
    start = pd.Period(sel.start or table.data_start, "M")
    end = pd.Period(sel.end or table.data_end, "M")
    return full.loc[start:end], full, start, end


def answer(table, sel, coverage_label, progress=None):
    months, full, start, end = monthly_for(table, sel)
    rows = [{"month": str(month), "activity": round(float(r.activity), 1), "low": round(float(r.low), 1),
             "high": round(float(r.high), 1), "estimated": bool(r.estimated),
             "terra_only": bool(r.terra_only), "median": round(float(r.median), 1)}
            for month, r in zip(months.index, months.itertuples())]
    return {"coverage": coverage_label, "progress": progress, "curve_source": table.curve_source,
            "data_through": table.data_through, "months": rows,
            "summary": summarize(full, start, end) if len(months) else None}


def empty_answer(coverage_label, detail=None):
    return {"coverage": coverage_label, "progress": None, "curve_source": None, "data_through": None,
            "months": [], "summary": None, "detail": detail}


def create_app(data_dir, cache_dir):
    data_dir = Path(data_dir)
    canada = load_region(data_dir)
    app = FastAPI(title="Fire calendar")
    app.state.canada = canada
    app.state.cache_dir = Path(cache_dir)

    @app.exception_handler(RequestValidationError)
    async def plain_validation_error(request: Request, exc: RequestValidationError):
        fields = ", ".join(str(e["loc"][-1]) for e in exc.errors())
        return JSONResponse({"detail": f"These values are missing or not understood: {fields}."}, status_code=422)

    def table_for(sel):
        """(table, coverage label, progress) for a selection; table is None when there is nothing to answer from."""
        where = coverage(sel.lat, sel.lon, sel.radius_km)
        if where == "outside":
            return None, "outside", None
        return canada, where, None

    @app.get("/api/activity")
    def activity(lat: float, lon: float, radius_km: int = 100,
                 start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to")):
        sel = Selection(lat, lon, radius_km, start, end)
        table, where, progress = table_for(sel)
        if table is None:
            return empty_answer(where)
        return answer(table, sel, where, progress)

    @app.get("/api/download/monthly.csv")
    def download_monthly(lat: float, lon: float, radius_km: int = 100,
                         start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to")):
        sel = Selection(lat, lon, radius_km, start, end)
        table, where, _ = table_for(sel)
        if table is None:
            raise HTTPException(404, "There is no fire history for this place yet.")
        months = monthly_for(table, sel)[0]
        name = f"fire-{sel.lat:.2f}_{sel.lon:.2f}_{sel.radius_km}km.csv"
        return Response(monthly_csv(months), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{name}"'})

    @app.get("/api/about")
    def about():
        def rows(name):
            path = data_dir / name
            return pd.read_csv(path).to_dict("records") if path.exists() else []
        return {"model": canada.model, "validation": rows("validation.csv"),
                "circle_validation": rows("circle_validation.csv"),
                "data_through": canada.data_through, "radii_km": list(RADII_KM)}

    @app.get("/api/charts/{name}.png")
    def chart(name: str):
        path = data_dir / f"{name}.png"
        if name not in CHARTS or not path.exists():
            raise HTTPException(404, "No such chart.")
        return FileResponse(path, media_type="image/png")

    return app


def _default_app():
    return create_app(os.environ.get("FIRE_DATA_DIR", "outputs/canada"), os.environ.get("FIRE_CACHE_DIR", "cache"))


def __getattr__(name):          # build the real app only when uvicorn asks for it, not on import in tests
    if name == "app":
        globals()["app"] = _default_app()
        return globals()["app"]
    raise AttributeError(name)
