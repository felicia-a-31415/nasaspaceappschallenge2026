# Fire calendar web app: design

14 November 2026, 4:30 PM. Step two of the project. It reads what the harmonization step (`harmonize/`) produces.

> **Changed on 14 November, 9 PM.** No Canada data is used. Wherever this document says Canada, read Quebec: the preloaded region is Quebec (`data/quebec`, `outputs/quebec`), "in the region" is decided with Quebec's outline, the curves are fitted on Quebec, and everywhere else is fetched on demand. The server reports `coverage` as `preloaded`, `partial`, `queued`, `fetching`, `fetched` or `outside`. The page's direction also changed; see `docs/frontend-handoff.md`, which wins where the two disagree.

## Why

The challenge asks for a web app where someone selects a region and a date range, sees a calendar of fire activity, compares it with the historical median, and downloads the result. Our audience is local residents first, who want one plain sentence ("is this normal?"), with a detailed view for people who want the calendar and the numbers.

The team also wants the app to work beyond Quebec and to show current data, using the NASA FIRMS API.

## Goals

- Click anywhere in Canada and get an answer instantly.
- Click anywhere else on Earth and get an answer on demand: recent years within about a minute, older history filling in behind.
- One plain sentence comparing the selected period with what is usual for that place.
- A calendar (years down, months across) of harmonized fire activity, with estimated months visibly different from observed ones.
- Downloads: monthly table (CSV), raw hotspots in the selection (CSV), calendar picture (PNG).
- Data that can be brought up to date with one command.

## Not goals

- No forecast or risk outlook.
- No user accounts, saved places or sharing links.
- No drawing of free shapes or rectangles. A region is a circle.
- No phone-specific layout. It should not break on a phone, but it is designed for a laptop screen.
- No Earth Engine or BigQuery. FIRMS files and the FIRMS API are the only fire data sources.

## Would count as failure

- A number shown without saying whether it is observed or estimated.
- Numbers outside Canada presented with the same confidence as numbers inside it.
- The FIRMS key visible in the browser or in the git history.
- A live demo that depends on a fetch that can take 30 minutes.
- The page and the downloaded CSV disagreeing.

## What we measured before designing

FIRMS API, tested with our key on 14 November:

| Test | Result |
| --- | --- |
| One year of one sensor, 73 five-day requests, 30 at once | 6 to 12 seconds |
| Budget cost of a five-day request, box up to California size | 6 to 10 of the 5,000 allowed per 10 minutes |
| Same request, Canada-sized box | 20 |
| One day, whole world | 36 |
| History the API serves | MODIS from 2000-11-01, VIIRS Suomi NPP from 2012-01-20, NOAA-20 from 2018-04-01 |

Consequences:

- Speed is not the limit. The budget is. NASA charges roughly 2 units per day fetched.
- A new place with full history is about 9,500 days, so 14,000 to 19,000 units: three or four 10-minute windows.
- The last six years of one sensor fit inside one window and arrive in under a minute.
- A box ten degrees wide costs the same as a town. So on-demand fetches should grab a wide box and keep it.
- One key serves one new place at a time.

Canada is already downloaded: `~/Downloads/DL_FIRE_M-C61_849316.zip`, `DL_FIRE_SV-C2_849318.zip`, `DL_FIRE_J1V-C2_849317.zip` (lat 41.8 to 82.3, lon -141.0 to -52.8, Nov 2000 to Nov 2026). The unzipped CSVs are 142 MB, 561 MB and 410 MB, too big for GitHub.

## Approaches considered

1. **The server does the counting (chosen by Felicia).** The page asks a Python server "what burned within this circle between these dates?" and the server answers from the burning-squares table. Canada and on-demand places share one code path, and the counting reuses the tested Python. Cost: nothing works unless the server is up.
2. **The browser does the counting for Canada.** Survives a server outage and feels instant, but the same maths would exist twice (JavaScript and Python) and only one copy has tests.
3. **Streamlit.** Fastest to put on screen, but it cannot do a full-screen map with a floating card and fits badly with results that fill in as they arrive.

Felicia also chose: the page is written in TypeScript with React.

## What the user sees

```
+--------------------------------------------------------------+
|  [ map of the world, full screen, drag and zoom ]            |
|                                    +-----------------------+ |
|        . . . . .                   | Near Chibougamau, QC  | |
|      .     x     .  <- 100 km      | Radius [50|100|200]   | |
|        . . . . .       circle      | From [2000-11] To [..]| |
|                                    |                       | |
|                                    | 2023 had 9 times more | |
|                                    | fire than usual here. |
|                                    | Most since 2000.      | |
|                                    |                       | |
|                                    |      J F M A M J J A..| |
|                                    | 2026 . . . # # # . .  | |
|                                    | 2025 . . . . # . . .  | |
|                                    | ...                   | |
|                                    | 2011 / / / / # / / /  | |
|                                    | (hatched = estimated) | |
|                                    |                       | |
|                                    | [CSV] [Hotspots] [PNG]| |
|                                    | How we made the two   | |
|                                    | satellites comparable | |
|                                    +-----------------------+ |
+--------------------------------------------------------------+
```

- Before any click the card says "Click anywhere to see its fire history."
- Hovering a calendar square shows the month, the activity, the low and high bounds if estimated, and how it compares with the median for that calendar month.
- Outside Canada the card shows progress ("Fetching 2019... 8 of 26 years") and the calendar fills in from the newest year backwards. A notice says the numbers there use Canada's correction and are less tested.
- If another place is already being fetched, the card says so and gives the position in the queue.
- "How we made the two satellites comparable" opens a short explanation with the before, after and test charts from the harmonization step.

## How it works

### Data preparation (runs on a laptop, before the demo)

- Run the existing pipeline with region `canada`. The raw CSVs go in `data/canada/`, which is added to `.gitignore`.
- The pipeline gains one new output: the burning-squares table for **both** sensors over the whole period (date, square, sensor). The server needs MODIS and VIIRS separately so it can re-do the correction for any circle. The existing `harmonized_daily.csv` keeps only the sensor in use.
- The curve is re-fitted on Canada and the hide-a-year test re-run. The new error figure replaces 17.9% wherever it is quoted.
- New test at the size users actually pick: for a few hundred random 100 km circles, hide each overlap year, predict it from MODIS, and report the error. This goes in the explanation panel and on the validity slide. If the error at 50 km is poor, the smallest radius is raised.

### Answering a click

For a circle and a month range, the server:

1. Selects the squares whose centre is inside the circle.
2. Counts burning square-days per month for each sensor.
3. Before February 2012, lifts the MODIS count with the fitted curve and attaches low and high bounds. A month with zero MODIS detections stays zero rather than being lifted. From February 2012 it uses the VIIRS count as observed.
4. Builds the sentence: takes the last year in the selected range, totals its months, and compares that with the median of the same months across all other years. It reports the ratio and the rank ("most since 2013"). If the median is zero or the place has almost no fire, it says that plainly instead of dividing.
5. Returns months, bounds, flags, the sentence, and whether the place is inside Canada.

Date ranges are whole months, because the correction is only valid at the month level.

### On-demand places

- A click outside the Canada box starts a fetch for a 10 by 10 degree box centred on the click. Bigger boxes cost the same and make later clicks nearby instant.
- Order: VIIRS from the current year backwards to 2012, then MODIS from 2011 back to 2000. Each finished year is gridded and becomes visible at once.
- The fetcher tracks the budget using the FIRMS status endpoint and pauses when the 10-minute window is nearly spent.
- One fetch runs at a time. Others queue.
- Finished boxes are saved and never fetched again.
- The correction uses Canada's curve. The place does not get its own curve in this version.

### Keeping current

One command, `python -m harmonize.refresh`, pulls the days since the last update for Canada through the API (a few dozen budget units), re-runs the counting, and publishes the new table. It is run by hand before the demo. A daily timer is a later addition.

### The server

Python with FastAPI, in `server/`. It imports `harmonize` for all counting and correction. Endpoints:

| Endpoint | Returns |
| --- | --- |
| `GET /api/activity?lat&lon&radius_km&from&to` | Months, bounds, flags, sentence, coverage (`canada`, `fetched`, `fetching`, `queued`) and progress |
| `GET /api/download/monthly.csv` (same parameters) | The same months as a CSV |
| `GET /api/download/hotspots.csv` (same parameters) | Raw hotspots in the circle, in the shared layout, labelled by sensor |
| `GET /api/about` | The curve, the error figures, and the date the data was last updated |

The page asks `/api/activity` again every two seconds while a place is still being fetched.

The key is read from the environment (`FIRMS_MAP_KEY`), locally from `.env`.

### The page

TypeScript and React, built with Vite, in `web/`. Map: Leaflet with OpenStreetMap tiles. The calendar is drawn by the page from the server's numbers. The PNG download is made in the browser from the drawn calendar. The colour ramp must stay readable for colour-blind users and estimated months get hatching, not only a different colour.

### Hosting

Google Cloud Run, one instance kept running (the fetch queue lives in memory), with a storage bucket for Canada's tables and saved on-demand boxes. The built page is served by the same server. Everything must first work on a laptop with `localhost`, so the demo can run locally if deployment is not ready.

## Build order

Sunday 3:00 PM is the submission deadline. Work is ordered so that stopping after any step still leaves something to show.

1. Canada data through the pipeline, both-sensor table, circle test.
2. Server answering clicks for Canada, with tests.
3. Page: map, card, sentence, calendar, monthly CSV download.
4. Deploy to Cloud Run. Record a screen capture of the working app as a backup.
5. On-demand fetching outside Canada.
6. Refresh command, hotspots CSV, PNG download, explanation panel.

Steps 1 to 3 are the challenge's minimum. If time runs short, cuts are made from the bottom.

## Constraints

- Files over 100 MB cannot go on GitHub. Raw Canada data stays out of the repo.
- 5,000 FIRMS budget units per 10 minutes on one key.
- `.env` is already ignored by git and must stay so.
- Existing harmonization tests must keep passing.

## Limits to state when presenting

- The correction is valid for an area over a month, not for one square on one day.
- Before 2012 the numbers are estimates with a range.
- Outside Canada the correction is borrowed from Canada and untested there.
- November 2000 to June 2002 had one MODIS satellite; those months are flagged.

## Calls made by Claude, open to change

- A region is a click plus a radius of 50, 100 or 200 km (default 100).
- Full-screen map with a floating card (layout A from the earlier mockups).
- Calendar is years by months.
- Date range is in whole months.
- The sentence compares the last year in the range with the median of the same months in other years.
- Zero MODIS detections in a month stays zero for a circle.
- On-demand box is 10 by 10 degrees; on-demand places borrow Canada's curve.
- The Canada files appear to be a country download (hotspots inside Canada's border only), not a box. So "in Canada" is decided with a simplified outline of Canada, not the bounding box; otherwise a click in Alaska or Maine would wrongly show no fire. A click outside the outline goes to on-demand. A circle that crosses the border is answered from Canada's data and marked "partial: the part outside Canada is not counted". The builder should confirm the country-download assumption by checking for hotspots just south of the border.
- FastAPI, Vite, Leaflet, OpenStreetMap tiles.
- Cloud Run with one always-on instance, and a local fallback for the demo.
- Refresh is run by hand.
- The build order above, including that on-demand comes after deployment.

## Left to the builder

- File format for the tables the server loads (CSV or Parquet) and how hotspots are stored so a circle can be cut out quickly.
- Exact wording of the sentence and its edge cases.
- Colour ramp, card styling, component structure.
- How the place name on the card is found (a free reverse-geocoding service, or just the coordinates).
- Whether saved on-demand boxes are kept on disk locally and in the bucket when deployed, or in one place only.

## Needed from the team

- A Google Cloud project with billing or credits, and who will do the deployment.
