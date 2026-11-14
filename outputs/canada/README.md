# Canada outputs

Produced by `python -m harmonize.run canada` on 14 November 2026 from the FIRMS country download for Canada (requests 849316, 849317, 849318). The raw CSVs live in `data/canada/` and are not in the repo (over 100 MB).

## What went in

| | Rows |
| --- | --- |
| Hotspots, all three datasets | 13,775,378 |
| MODIS | 1,760,225 |
| VIIRS Suomi NPP | 6,926,040 |
| VIIRS NOAA-20 | 5,089,113 |
| Burning square-days (0.1 degree squares, both sensors) | 833,026 |

Period: 1 November 2000 to 14 November 2026. The files hold hotspots inside Canada's border only (checked: none in the US strip south of 48.9 N between 123 W and 96 W).

## Canada-wide curve

`log1p(VIIRS) = 2.609 + 0.733 * log1p(MODIS)`, sigma 0.169, fitted on monthly totals February 2012 to December 2025.

Hide-a-year test, mean error predicting a year's VIIRS total from MODIS alone:

| Method | Error |
| --- | --- |
| No correction | 44.9% |
| One fixed multiplier | 11.2% |
| Fitted curve | 8.1% |

Worst year for the curve: 2023 (25.1% under). This replaces the 17.9% figure from the Quebec-only run.

## Curves for circles

The Canada-wide curve is only right for Canada-wide totals. For a single burning square-day it would return about 21. So each radius the app offers has its own curve, fitted on monthly counts from 300 random circles of that size (`model.json`, key `by_radius`).

Hide-a-year test on those circles, scoring circle-years with at least 10 VIIRS square-days:

| Radius | Circle-years | Median error, no correction | Median error, curve | Within half to double |
| --- | --- | --- | --- | --- |
| 50 km | 2,431 | 46.7% | 26.1% | 80.3% |
| 100 km | 3,419 | 44.4% | 21.0% | 87.8% |
| 200 km | 3,985 | 43.1% | 20.7% | 89.5% |

A month where MODIS saw nothing stays at zero. That misses a little real fire: 6.1% of VIIRS activity at 50 km, 2.3% at 100 km, 0.6% at 200 km fell in such months.

## Files

| File | Contents |
| --- | --- |
| `cell_days.parquet` | Every burning square by day, for both sensors (the web server reads this) |
| `hotspots.parquet` | All hotspots in the shared layout (294 MB, not in the repo) |
| `model.json` | Canada-wide curve and the per-radius curves |
| `circle_validation.csv` | The circle test above |
| `harmonized_monthly.csv`, `harmonized_daily.csv` | Canada-wide series |
| `validation.csv`, `*.png` | Canada-wide test and charts |
