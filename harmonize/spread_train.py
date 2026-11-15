"""Train and test the fire spread model on Quebec.

    python -m harmonize.spread_train                # fetch weather (cached), build, test, save
    python -m harmonize.spread_train --weather-only

Writes to outputs/quebec/:
  spread_model.pkl          the served model (trained with the test season held out)
  spread_validation.json    scores on held-out seasons against two simple baselines

The test is honest in one way that matters: every score comes from a season
the model never saw. 2023, the demo season, is never used for training the
served model.
"""
import argparse
import json
import pickle
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

from harmonize.schema import clean
from server import forecast, spread, weather

OUT = Path("outputs/quebec")
CACHE = Path("cache")
WEATHER_FILE = CACHE / "spread_weather.parquet"
FIRST, LAST = date(2012, 1, 1), date(2026, 11, 13)
SERVED_HOLDOUT = 2023
TEST_SEASONS = (2013, 2023, 2026)
NEAR_KEEP_KM = 6.0               # keep every candidate this close to today's fire
FAR_RATE = 0.04                  # and this share of the rest (weighted back up)
SEED = 7


def viirs_fires(path=OUT / "hotspots.parquet"):
    h = clean(pd.read_parquet(path))
    h = h[(h["sensor"].astype(str) == "VIIRS") & (h["acq_date"] >= pd.Timestamp(FIRST))]
    return h[["latitude", "longitude", "acq_date", "frp"]].reset_index(drop=True)


# ----- weather ---------------------------------------------------------------------------------

def fetch_weather(fires, workers=6):
    """NASA POWER daily weather at every grid point that had fire, cached on disk."""
    tl, tn = spread.tile_of(fires["latitude"].to_numpy(), fires["longitude"].to_numpy())
    tiles = sorted(set(zip(tl.tolist(), tn.tolist())))
    have = {}
    if WEATHER_FILE.exists():
        old = pd.read_parquet(WEATHER_FILE)
        have = {k: g.drop(columns=["tlat", "tlon"]).to_dict("records") for k, g in old.groupby(["tlat", "tlon"])}
    todo = [t for t in tiles if t not in have]
    print(f"weather: {len(tiles)} grid points, {len(todo)} to fetch")

    def one(t):
        for attempt in range(4):
            try:
                return t, weather.daily(t[0], t[1], FIRST, LAST)
            except weather.WeatherError as e:
                time.sleep(5 * (attempt + 1))
        print("  gave up on", t)
        return t, []

    done = 0
    with ThreadPoolExecutor(workers) as pool:
        for t, rows in pool.map(one, todo):
            have[t] = rows
            done += 1
            if done % 25 == 0 or done == len(todo):
                print(f"  {done}/{len(todo)}")
                _save_weather(have)
    return {t: have[t] for t in tiles}


def _save_weather(have):
    parts = [pd.DataFrame(rows).assign(tlat=t[0], tlon=t[1]) for t, rows in have.items() if rows]
    if parts:
        CACHE.mkdir(exist_ok=True)
        pd.concat(parts, ignore_index=True).to_parquet(WEATHER_FILE, index=False)


# ----- dataset ---------------------------------------------------------------------------------

def build(fires, w, rng):
    """Rows for every forecast day: features, horizon, label, weight, and whether the square is new."""
    cells = spread.burning_cells(fires)
    days = spread.Days(cells)
    issues = sorted(days.by_day)
    parts = []
    for n, issue in enumerate(issues):
        cand = spread.candidates(days.codes(issue))
        f = spread.features(days, issue, cand, w)
        near = f["d_now"].to_numpy() <= NEAR_KEEP_KM
        for h in spread.HORIZONS:
            y = spread.labels(days, issue, cand, h)
            keep = near | (y == 1) | (rng.random(len(f)) < FAR_RATE)
            g = spread.add_ahead(spread.with_horizon(f[keep], h), w, issue, h)   # the weather that then happened
            g["y"] = y[keep]
            g["weight"] = np.where(near[keep] | (y[keep] == 1), 1.0, 1.0 / FAR_RATE)
            g["issue"] = issue
            parts.append(g)
        if n % 200 == 0:
            print(f"  day {n}/{len(issues)} {issue.date()}")
    data = pd.concat(parts, ignore_index=True)
    data["new"] = (data["self_now"] == 0) & (data["self_prev"] == 0)
    data["season"] = data["issue"].dt.year
    return data


# ----- models ----------------------------------------------------------------------------------

def gbm():
    return HistGradientBoostingClassifier(max_iter=400, learning_rate=0.06, max_leaf_nodes=31,
                                          min_samples_leaf=200, l2_regularization=1.0,
                                          early_stopping=True, validation_fraction=0.1, random_state=SEED)


class DistanceOnly:
    """Baseline: chance from distance to today's fire and days ahead only."""
    cols = ["d_now", "horizon"]

    def fit(self, X, y, sample_weight=None):
        Z = self._z(X)
        self.m = LogisticRegression(max_iter=1000).fit(Z, y, sample_weight=sample_weight)
        return self

    def _z(self, X):
        d = X["d_now"].to_numpy()
        h = X["horizon"].to_numpy()
        return np.column_stack([d, np.log1p(d), d == 0, np.log(h), np.log1p(d) * np.log(h)])

    def predict_proba(self, X):
        return self.m.predict_proba(self._z(X))


class NoWeather:
    """The same tree model without any weather: shows what NASA POWER adds."""
    drop = ["wind_ms", "downwind", "crosswind", "temp_max_c", "humidity_pct", "precip_mm", "rain_3d"]

    def fit(self, X, y, sample_weight=None):
        self.cols = [c for c in spread.FEATURES if c not in self.drop]
        self.m = gbm().fit(X[self.cols], y, sample_weight=sample_weight)
        return self

    def predict_proba(self, X):
        return self.m.predict_proba(X[self.cols])


def scores(y, p, wt):
    if y.sum() == 0 or y.sum() == len(y):
        return None
    return {"roc_auc": round(float(roc_auc_score(y, p, sample_weight=wt)), 3),
            "avg_precision": round(float(average_precision_score(y, p, sample_weight=wt)), 3),
            "brier": round(float(brier_score_loss(y, p, sample_weight=wt)), 4),
            "base_rate": round(float(np.average(y, weights=wt)), 4)}


def at_threshold(y, p, wt, t=0.5):
    """Of the squares that newly burned, what share did we flag; of those we flagged, what share burned."""
    flag = p >= t
    caught = float(np.sum(wt * (flag & (y == 1))))
    return {"threshold": t,
            "caught_share": round(caught / max(float(np.sum(wt * (y == 1))), 1e-9), 3),
            "flag_precision": round(caught / max(float(np.sum(wt * flag)), 1e-9), 3)}


def calibration(y, p, wt, bins=(0, .05, .1, .2, .3, .5, .7, 1.01)):
    out = []
    for lo, hi in zip(bins[:-1], bins[1:]):
        m = (p >= lo) & (p < hi)
        if m.sum():
            out.append({"from": lo, "to": min(hi, 1.0), "predicted": round(float(np.average(p[m], weights=wt[m])), 3),
                        "observed": round(float(np.average(y[m], weights=wt[m])), 3), "rows": int(m.sum())})
    return out


class Today:
    """The tree model with only what is known on the day (today's weather included)."""

    def fit(self, X, y, sample_weight=None):
        self.m = gbm().fit(X[spread.FEATURES], y, sample_weight=sample_weight)
        return self

    def predict_proba(self, X):
        return self.m.predict_proba(X[spread.FEATURES])


class WithForecast:
    """The tree model that also sees the weather of the coming days (AHEAD columns)."""

    def fit(self, X, y, sample_weight=None):
        self.m = gbm().fit(X[spread.FORECAST_FEATURES], y, sample_weight=sample_weight)
        return self

    def predict_proba(self, X):
        return self.m.predict_proba(X[spread.FORECAST_FEATURES])


def evaluate(data, season):
    train, test = data[data["season"] != season], data[data["season"] == season]
    X, y, wt = train, train["y"].to_numpy(), train["weight"].to_numpy()
    models = {"model": Today().fit(X, y, sample_weight=wt),
              "perfect_forecast": WithForecast().fit(X, y, sample_weight=wt),
              "no_weather": NoWeather().fit(X, y, sample_weight=wt),
              "distance_only": DistanceOnly().fit(X, y, sample_weight=wt)}
    report = {"season": season, "train_rows": len(train), "test_rows": len(test), "by_horizon": {}}
    for h in spread.HORIZONS:
        th = test[test["horizon"] == h]
        new = th[th["new"]]
        row = {}
        for name, m in models.items():
            p_all = m.predict_proba(th)[:, 1]
            p_new = m.predict_proba(new)[:, 1]
            row[name] = {"all": scores(th["y"].to_numpy(), p_all, th["weight"].to_numpy()),
                         "new_squares": scores(new["y"].to_numpy(), p_new, new["weight"].to_numpy()),
                         "new_at_0.5": at_threshold(new["y"].to_numpy(), p_new, new["weight"].to_numpy()),
                         "new_at_0.3": at_threshold(new["y"].to_numpy(), p_new, new["weight"].to_numpy(), 0.3)}
            if name == "model":
                row[name]["calibration_new"] = calibration(new["y"].to_numpy(), p_new, new["weight"].to_numpy())
        report["by_horizon"][str(h)] = row
        m, b = row["model"]["new_squares"], row["distance_only"]["new_squares"]
        if m and b:
            print(f"  {season} h={h}: new-square AP {m['avg_precision']:.3f} vs distance-only {b['avg_precision']:.3f} "
                  f"(AUC {m['roc_auc']:.3f} vs {b['roc_auc']:.3f}, base rate {m['base_rate']:.3f})")
    return report, models


def importance(model, data, season, n=40_000):
    """Permutation importance on held-out rows: how much worse the model gets without each input."""
    from sklearn.inspection import permutation_importance
    test = data[(data["season"] == season)]
    test = test.sample(min(n, len(test)), random_state=SEED)
    r = permutation_importance(model, test[spread.FEATURES], test["y"], scoring="average_precision",
                               n_repeats=3, random_state=SEED, sample_weight=test["weight"])
    order = np.argsort(-r.importances_mean)
    return [{"feature": spread.FEATURES[i], "drop_in_avg_precision": round(float(r.importances_mean[i]), 4)}
            for i in order]


ZONE_SHARES = (0.02, 0.05, 0.10, 0.20)


def zones(model, data, season):
    """Warning zones on the held-out season, as a responder would use them.

    For each day ahead: flag the given share of the area within REACH_KM of
    today's fire, the squares the model rates highest. What share of the squares
    that newly burned fell inside? The baseline flags the same area by distance
    alone (the closest squares), so the two are compared at equal cost.
    """
    test = data[(data["season"] == season) & data["new"]]
    out = {}
    for h in spread.HORIZONS:
        t = test[test["horizon"] == h]
        y, wt = t["y"].to_numpy(), t["weight"].to_numpy()
        p = model.predict_proba(t[spread.FEATURES])[:, 1]
        rows = []
        for share in ZONE_SHARES:
            rows.append({"area_share": share, "model_caught": _caught(p, y, wt, share),
                         "nearest_caught": _caught(-t["d_now"].to_numpy(), y, wt, share),
                         "model_threshold": round(float(_cut(p, wt, share)), 3)})
        out[str(h)] = rows
        best = rows[2]
        print(f"  zones {season} h={h}: top {best['area_share']:.0%} of area catches {best['model_caught']:.0%} "
              f"of new burns vs {best['nearest_caught']:.0%} by distance")
    return out


def _cut(score, wt, share):
    order = np.argsort(-score)
    filled = np.cumsum(wt[order]) / wt.sum()
    return score[order][min(np.searchsorted(filled, share), len(score) - 1)]


def _caught(score, y, wt, share):
    order = np.argsort(-score)
    filled = np.cumsum(wt[order]) / wt.sum()
    inside = order[filled <= share]
    return round(float((wt[inside] * y[inside]).sum() / max((wt * y).sum(), 1e-9)), 3)


FORECAST_WINDOW = (date(2023, 5, 20), date(2023, 8, 31))   # the main 2023 fires; archive quota keeps it to this
TEST_LEADS = (1, 2, 3)
ARCHIVE_FILE = CACHE / "forecast_archive_2023.parquet"


def fetch_archived(fires, first, last, leads=TEST_LEADS, workers=2):
    """Archived Open-Meteo forecasts at each weather grid point with fire, cached: {lead: weather frame}."""
    near = fires[(fires["acq_date"] >= pd.Timestamp(first)) & (fires["acq_date"] <= pd.Timestamp(last))]
    tl, tn = spread.tile_of(near["latitude"].to_numpy(), near["longitude"].to_numpy())
    tiles = sorted(set(zip(tl.tolist(), tn.tolist())))
    have = pd.read_parquet(ARCHIVE_FILE) if ARCHIVE_FILE.exists() else pd.DataFrame(columns=["tlat", "tlon", "lead"])
    done = set(zip(have["tlat"], have["tlon"]))
    todo = [t for t in tiles if t not in done]
    print(f"archived forecasts: {len(tiles)} grid points, {len(todo)} to fetch")

    def one(t):
        try:
            got = forecast.archived(t[0], t[1], first + timedelta(days=1), last + timedelta(days=max(leads)), leads)
        except forecast.ForecastError as e:
            print("  gave up on", t, e)
            return []
        return [pd.DataFrame(rows).assign(tlat=t[0], tlon=t[1], lead=k) for k, rows in got.items() if rows]

    parts = [have] if len(have) else []
    with ThreadPoolExecutor(workers) as pool:
        for n, got in enumerate(pool.map(one, todo), 1):
            parts.extend(got)
            if n % 25 == 0 or n == len(todo):
                print(f"  {n}/{len(todo)}")
                CACHE.mkdir(exist_ok=True)
                pd.concat(parts, ignore_index=True).to_parquet(ARCHIVE_FILE, index=False)
    allrows = pd.concat(parts, ignore_index=True) if parts else have
    out = {}
    for k in leads:
        sub = allrows[allrows["lead"] == k]
        out[k] = spread.weather_frame({(a, b): g.drop(columns=["tlat", "tlon", "lead"]).to_dict("records")
                                      for (a, b), g in sub.groupby(["tlat", "tlon"])})
    return out


def forecast_test(served, data, fires, season):
    """The honest test: the forecast model given what was really forecast at the time.

    Same held-out rows (new squares, the main 2023 fires), three ways: today's
    weather only; the archived forecast; the weather that then happened (the ceiling).
    """
    first, last = FORECAST_WINDOW
    archive = fetch_archived(fires, first, last)
    test = data[(data["season"] == season) & data["new"] & data["horizon"].isin(TEST_LEADS)
                & (data["issue"] >= pd.Timestamp(first)) & (data["issue"] <= pd.Timestamp(last))]
    parts = [spread.add_ahead(g, archive, issue, h) for (issue, h), g in test.groupby(["issue", "horizon"])]
    forecast_rows = pd.concat(parts)
    perfect = test.loc[forecast_rows.index]
    out = {"window": [first.isoformat(), last.isoformat()], "source": forecast.SOURCE, "by_horizon": {}}
    for h in TEST_LEADS:
        a, b = perfect[perfect["horizon"] == h], forecast_rows[forecast_rows["horizon"] == h]
        y, wt = a["y"].to_numpy(), a["weight"].to_numpy()
        row = {"missing_forecast_share": round(float(b["ahead_wind_ms"].isna().mean()), 3)}
        for name, model, rows in (("today_weather", served["model"], a),
                                  ("archived_forecast", served["perfect_forecast"], b),
                                  ("perfect_forecast", served["perfect_forecast"], a)):
            p = model.predict_proba(rows)[:, 1]
            row[name] = {"avg_precision": round(float(average_precision_score(y, p, sample_weight=wt)), 3),
                         "zone2_caught": _caught(p, y, wt, 0.02), "zone5_caught": _caught(p, y, wt, 0.05)}
        out["by_horizon"][str(h)] = row
        t, f, c = row["today_weather"], row["archived_forecast"], row["perfect_forecast"]
        print(f"  forecast test h={h}: AP today {t['avg_precision']:.3f} | archived forecast {f['avg_precision']:.3f} "
              f"| perfect {c['avg_precision']:.3f} ; top-5% zone {t['zone5_caught']:.0%} / {f['zone5_caught']:.0%} "
              f"/ {c['zone5_caught']:.0%} (missing {row['missing_forecast_share']:.0%})")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weather-only", action="store_true")
    ap.add_argument("--zones-only", action="store_true", help="add warning-zone scores using the saved model")
    args = ap.parse_args()

    fires = viirs_fires()
    print(f"{len(fires)} VIIRS hotspots")
    rows = fetch_weather(fires)
    if args.weather_only:
        return
    w = spread.weather_frame(rows)
    if args.zones_only:
        with open(OUT / "spread_model.pkl", "rb") as fh:
            model = pickle.load(fh)["model"]
        held = fires[fires["acq_date"].dt.year.between(SERVED_HOLDOUT - 1, SERVED_HOLDOUT + 1)]
        data = build(held, w, np.random.default_rng(SEED))
        report = json.loads((OUT / "spread_validation.json").read_text())
        report["zones"] = zones(model, data, SERVED_HOLDOUT)
        (OUT / "spread_validation.json").write_text(json.dumps(report, indent=1))
        return
    print("building rows")
    data = build(fires, w, np.random.default_rng(SEED))
    print(f"{len(data)} rows, {int(data['y'].sum())} positive")

    reports, served = [], None
    for season in TEST_SEASONS:
        print(f"testing on {season}")
        rep, models = evaluate(data, season)
        reports.append(rep)
        if season == SERVED_HOLDOUT:
            served = models
    imp = importance(served["model"].m, data, SERVED_HOLDOUT)
    zone_scores = zones(served["model"].m, data, SERVED_HOLDOUT)
    test = forecast_test(served, data, fires, SERVED_HOLDOUT)

    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "spread_model.pkl", "wb") as fh:
        pickle.dump({"model": served["model"].m, "features": spread.FEATURES,
                     "forecast_model": served["perfect_forecast"].m, "forecast_features": spread.FORECAST_FEATURES,
                     "forecast_source": forecast.SOURCE, "sklearn": sklearn.__version__,
                     "held_out": SERVED_HOLDOUT, "trained": date.today().isoformat()}, fh)
    (OUT / "spread_validation.json").write_text(json.dumps(
        {"label": spread.SPREAD_LABEL, "cell_deg": [spread.DLAT, spread.DLON], "reach_km": spread.REACH_KM,
         "served_model_held_out": SERVED_HOLDOUT, "seasons": reports, "importance": imp, "zones": zone_scores,
         "forecast_test": test}, indent=1))
    print("saved")


if __name__ == "__main__":
    main()
