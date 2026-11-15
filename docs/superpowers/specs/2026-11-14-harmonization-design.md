# Harmonizing MODIS and VIIRS hotspots: design

14 November 2026. Step one of the project; the web app comes after and reads this step's output.

## Why

The fire record for our area (Quebec box, lat 45.0 to 62.4, lon -79.5 to -57.2) comes from two kinds of satellite camera. MODIS runs from 2000, VIIRS from 2012. VIIRS is sharper and reports far more hotspots for the same fires, so raw counts from 2005 and 2024 cannot share one chart. We want one fire history where the sensor no longer matters, and evidence that judges can trust it.

## What we measured first (2012 to 2025, both sensors flying)

| Way of counting | VIIRS vs MODIS | Year-to-year range |
| --- | --- | --- |
| Raw hotspots | 5.6 times more | 3.1 to 6.0 |
| Burning 0.1 degree squares per day | 1.6 times more | 1.3 to 3.9 |

- The gap is small in huge fire years (2013, 2023) and large in quiet years, so one fixed multiplier is wrong.
- Monthly totals from the two sensors track each other closely (correlation 0.95 on a log scale).
- At the level of one square on one day they do not match: MODIS catches about half of what VIIRS does. The correction is valid for an area over a month, not for a single square.

## Goals

- One table of fire activity from Nov 2000 to Nov 2026 in a single unit.
- A measured error for the correction, from years the method never saw.
- A plain view of how the three source datasets differ, column by column.

## Not goals

- No web app, map, or forecast in this step.
- No correction of individual hotspots. Raw hotspots stay available for the CSV download, labelled with their sensor.
- No data outside the downloaded box.

## Would count as failure

- A harmonized series with a visible jump at 2012.
- Numbers presented without their error, or estimated values that look the same as observed ones.

## Approaches considered

1. **Lift MODIS up to VIIRS level (chosen).** Count burning squares, fit a curve on the overlap years, apply it to MODIS before 2012. Keeps VIIRS detail for recent years, as the challenge asks.
2. **Blur VIIRS down to MODIS level.** Simpler to defend, but throws away the detail the challenge wants kept.
3. **One fixed multiplier on raw counts.** Ruled out by the data: the ratio swings from 3.1 to 6.0.

## The pipeline

Python with pandas. Each stage writes a file the next one reads.

1. **Compare the sources (friend's idea).** A table with one row per column and one column per dataset (MODIS, VIIRS Suomi NPP, VIIRS NOAA-20, archive and recent files): is the column present, its type, range or set of values, and share of blanks. Known differences it should surface: `confidence` is a number 0 to 100 in MODIS and a letter l/n/h in VIIRS; the recent files have no `type` column; pixel size (`scan`, `track`) differs; brightness is measured on different channels; Suomi NPP labels its instrument "SNPP" rather than "VIIRS".
2. **One shared layout (friend's idea).** Combine all six files into one table with identical columns. Where a dataset lacks a value, keep the column, leave it blank, and set a flag column saying so (for example `type_missing`). Add `sensor` (MODIS / VIIRS), `satellite`, `source_file` (archive / recent), and a shared `confidence_level` (low / nominal / high; MODIS under 30 is low, 30 to 79 nominal, 80 and up high, the grouping FIRMS itself uses).
3. **Clean.** Drop rows marked as not vegetation fires (`type` 2 and 3). The recent files have no `type`, so their rows are kept and flagged. Added during the build: a recent row is also dropped when it sits on a spot (0.01 degree square) where the archive has 3 or more non-fire detections, because about half of the recent rows turned out to be smelters, mills and similar. Every row carries a `likely_static` flag. Data now lives in `data/<region>/` and outputs in `outputs/<region>/`.
4. **Count.** For each sensor, day and 0.1 degree square (about 11 km by 7 km): did it burn, yes or no. For VIIRS, Suomi NPP is the reference; NOAA-20 fills in after Suomi NPP's last date.
5. **Fit.** On overlap months, fit VIIRS monthly burning square-days against MODIS on a log scale, so the correction shrinks as activity grows.
6. **Test.** Hide each overlap year in turn, fit on the rest, predict the hidden year, and report the error per year and overall. Also report the same error for the "do nothing" and "fixed multiplier" options as a baseline.
7. **Output.**
   - `harmonized_daily.csv`: date, square, burning (yes/no), sensor used.
   - `harmonized_monthly.csv`: month, activity in VIIRS-level square-days, low and high bounds, and an `estimated` flag (true before 2012, where the value is lifted from MODIS).
   - `hotspots_unified.csv`: the shared-layout table from stage 2.
   - Charts: monthly counts for all three sensors before, the single series after, and the test result.

## Constraints

- Presentation sign-up closes Sunday 3:00 PM; this step should be done Saturday.
- Source CSVs are not modified. Outputs go in a new folder.
- Files over 100 MB cannot go on GitHub.

## Calls made during design, open to change

- Square size 0.1 degrees. Sizes from 0.05 to 1.0 gave nearly the same ratio; 0.1 is fine enough for a town-sized view.
- Suomi NPP as the VIIRS reference, because it has the longest overlap with MODIS.
- Day and night detections counted together.
- Only Terra flew before mid-2002, so Nov 2000 to mid-2002 gets an extra flag as less complete.

## Left to the builder

File and function names, chart styling, the exact curve form if a straight line on the log scale fits poorly.
