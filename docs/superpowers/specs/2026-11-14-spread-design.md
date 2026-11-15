# Experimental spread forecast (`/api/spread`)

Built on 14 November 2026 at the team's request ("warn where the fire would spread based on time for a given location"). It is labelled "Experimental spread forecast" everywhere.

## What it does

`GET /api/spread?lat&lon&radius_km=50&on=YYYY-MM-DD&days=3`

For each ~2 km square within 30 km of fire seen inside the circle on `on`, it gives the chance VIIRS sees fire there within 1..`days` days (up to 7). For the chosen point it gives the nearest fire, the chance fire comes within about 2 km by each day, and the first day that chance reaches 1 in 10 (`warning_by_day`). Every answer includes the held-out test scores (`tested`).

## Model

- scikit-learn `HistGradientBoostingClassifier`, one model, days ahead as an input.
- Inputs, all known on `on`: distance to fire today, yesterday and the day before (and how much closer it got), burning squares within 3/5/10/20 km, fire intensity (FRP) within 10 km, growth over two days, whether the square already burned this season, NASA POWER weather at the nearest fire (wind speed, wind along and across the line to the square, max temperature, humidity, rain today and over 3 days), day of year, latitude.
- Label: VIIRS (both satellites) detects fire in the square on any day in the window.
- Training data: every day with VIIRS fire in Quebec, 2012 to 2026 (3.8 M rows, far squares sampled at 4% and weighted back up). Weather: 532 NASA POWER grid points, cached in `cache/spread_weather.parquet` (not committed).
- Code: `server/spread.py` (features, forecast), `harmonize/spread_train.py` (weather, training, tests). Rebuild with `python -m harmonize.spread_train` (about 15 minutes once the weather is cached).

## Weather forecast (added 15 November)

There are two models. The forecast model also sees the weather expected over the coming days (mean wind, wind along and across the line to the square, highest temperature, humidity, rain), and the endpoint uses it whenever every day asked for has a forecast. Otherwise it falls back to today's-weather model, and `weather_used` says which one ran for each day.

- Forecasts come from Open-Meteo (free, no key), always Japan's global model, JMA GSM. It is the one model whose forecasts are archived with lead times back to 2018, so 2023 can be tested on what was really forecast then. GFS and GEM archives have no wind for 2023. `server/forecast.py`: for a recent day it uses the current forecast, for an older day the archive (forecast issued N days before).
- Training uses the NASA POWER weather that actually happened on those days (the only source covering 2012 to 2026). The test uses archived JMA forecasts, so the scores include forecast error.
- Honest 2023 test, 20 May to 31 August 2023, new squares, precision score (average precision):

| Days ahead | Today's weather only | Archived JMA forecast | Weather that happened (ceiling) |
| --- | --- | --- | --- |
| 1 | 0.196 | 0.203 | 0.214 |
| 2 | 0.226 | 0.252 | 0.272 |
| 3 | 0.238 | 0.268 | 0.291 |

The real forecast keeps about 60% of the possible gain. On the 2 June 2023 Lebel-sur-Quévillon fire, the 1-in-10 zone for 3 days caught 73 of 336 new squares with the forecast, against 23 without it. Days 5 and 7 were only tested with the weather that happened, because the archive download was limited to 3 lead days to stay inside Open-Meteo's free daily allowance.

## How good it is (squares that were not already burning; scores from seasons the model never saw)

| Held-out season | Precision score, 1 day ahead (model / distance only / model without weather) | 3 days ahead (model / distance only) |
| --- | --- | --- |
| 2013 | 0.25 / 0.14 / 0.15 | 0.24 / 0.17 |
| 2023 (the demo season; the served model never saw it) | 0.20 / 0.14 / 0.16 | 0.24 / 0.20 |
| 2026 | 0.17 / 0.12 / 0.12 | 0.19 / 0.15 |

The precision score is average precision. A random guess would score the share of squares that burn, about 0.01.

Warning zones on 2023, 1 day ahead: the top 2% of the area within 30 km caught 40% of the squares that newly burned (distance alone: 35%); the top 10% caught 78% (distance: 74%). Most of the skill is "close to today's fire". The model's edge is in ranking the riskiest squares and in giving calibrated chances, and NASA POWER weather is a real part of that edge.

## Limits to say out loud

- Without a forecast (Open-Meteo down, or more days asked than it covers) it uses the weather on `on` and assumes it holds. Blow-up days driven by a wind change are then missed: on the 2 June 2023 fire, the 1-in-10 zone caught 23 of 336 new squares that way.
- The forecast weather is one model at about 50 km, and the fire's own wind is not in it.
- No fuel, terrain, lakes, roads or firefighting.
- VIIRS misses fire under thick smoke or cloud, so some "misses" in the test are gaps in the record.
- Above about 50%, the chances run high: squares rated 60 to 80% burned 40 to 60% of the time in 2023.
- Trained and tested on Quebec only.
- Not for evacuation decisions. Official sources are SOPFEU and the Canadian Wildland Fire Information System.
