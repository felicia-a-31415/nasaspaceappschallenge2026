# Quebec fire record — the web page

A full-screen map of every fire detection in Quebec since 2000, played through time, for
emergency responders. The backend owns the data and the server (`harmonize/`, `server/`);
this folder is the page. The two sides meet only at the HTTP endpoints.

## Running it

```
npm install
python3 scripts/make-mock-hotspots.py   # once: builds the 20 MB sample, gitignored
npm run dev
```

That runs against mocks. The mocks answer from the same hotspots the map is drawing, so
the panel and the dots always agree.

Against the real server, started from the repo root:

```
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn server.app:app --port 8000
```

```
VITE_USE_MOCKS=false npm run dev
```

`/api` is proxied to `http://localhost:8000` in development. A production build is the
other way round: it is the page the server itself serves at `/`, so it talks to the real
endpoints unless `VITE_USE_MOCKS=true` is set at build time, and it never needs a host
name. `npm run build` also leaves the 20 MB sample out of `dist/`.

## Checks

```
npm test           # unit tests
npm run build      # type check and production build
```

## Layout

| Path | What it holds |
| --- | --- |
| `src/types.ts` | Every response shape, copied from the handoff. The only place to update if the backend changes one. |
| `src/api.ts` | One function per endpoint, each with a mock twin chosen by `VITE_USE_MOCKS`. Nothing else calls `fetch`. |
| `src/view.ts` | The `View`: place, radius, period, mode. Parsed from and written to the query string. Everything that reads the selection reads it from here. |
| `src/forecast.ts` | The reserved forecast seam: a type, a layer id, and "not available". No endpoint shape is invented. |
| `src/mocks/` | The mock twins, derived from the loaded hotspots. |
| `src/hooks/` | `useView` (the address), `useTimeline` (playback and the period), `usePanel` (the panel's three answers, landed together). |
| `src/map/` | MapLibre + deck.gl: the dots, the intensity glow, the colour ramp, the video frames. |
| `src/components/` | Three surfaces over the map: the control cluster, the time dock (`TimeBar`), the panel (`Panel`). |
| `src/lib/` | Dates, months, distances, coordinate parsing, the range-drag arithmetic, the track's monthly shape. |

## Decisions worth knowing

- **No API keys anywhere.** Base map: CARTO's dark style (free, no key). Place search:
  Nominatim (free, no key). A key used in a browser is visible to everyone, so nothing
  secret can live here; the NASA key stays on the server.
- **All 723,108 dots live on the graphics card.** Time filters there through
  `DataFilterExtension`, so the data is never rebuilt. Playing runs through the chosen
  period, A to B: the map shows everything from A up to the playhead, so fires stay once
  they appear and nothing before A is shown. Pausing hands over A to where it stopped,
  and play carries on from there.
- **The time track is one pointer-driven control**, not two stacked sliders: the pointer
  moves whichever handle is nearer, handles can share a month and pass through each other
  (`lib/rangeDrag.ts`). Each handle is still its own keyboard stop.
- **The glow is weighted by intensity, never by detection count**, because detection
  density follows which camera was flying. `HeatmapLayer` aggregates on its own and does
  not take the day filter, so the glow is fed just the chosen days (hotspots are in day
  order, so that is one `subarray`) and is only shown when paused. The dots are the layer
  that plays. deck.gl logs a harmless `weightsTexture not set` warning for it.
- **The shape behind the time track scales each camera separately**, for the same reason
  the yearly chart is two charts.
- **The view lives in the query string** (`?lat&lon&radius_km&from&to&mode`), replaced,
  not pushed, and debounced. A plain address plays the record; a link shows its view.
  A missing `to` means "the end of the record", so a link keeps up as data arrives.
- **"On shift" is the same data re-ordered**, under a banner saying it is a historical
  record with its end date. Nothing in it is live and nothing is drawn as a spread.
- **The timeline's end is extensible** (`extendTo` in `useTimeline`), so something dated
  after the record has room. Nothing uses it yet.
- **Colour means intensity**, on the "inferno" ramp, which rises steadily from dark to
  light and so survives every kind of colour blindness. Stronger fires are also drawn
  larger, so colour is never the only signal.
- **Raw counts before and after February 2012 are never compared.** A sharper camera took
  over then. The notice by the slider and the break in the yearly chart both say so.
- **The video export writes its own overlays.** Overlays drawn as HTML are not part of
  the map's canvas, so the date, legend, 2012 notice and credits are painted into each
  frame (`src/map/videoFrame.ts`). The map is created with `preserveDrawingBuffer` for
  this to capture anything.

## The look

A survey instrument, not a dashboard. A few flat, matte cards sit on the map: a search
box top left, a small card of findings top right that opens into the full panel ("More
detail"), the time line along the bottom, the key in the corner. IBM Plex ships with the
page (`@fontsource`, no network): Sans for the interface, Mono for anything read off an
instrument (dates, coordinates, ticks), and Serif for one thing only, the corrected
sentence. The fire ramp is the only warm colour; one blue marks what the user chose;
amber is the February 2012 notice. The reasoning is at the top of `src/index.css`.

## Seams left for later

- **Place suggestions (Google Places).** `suggestPlaces` and `resolveSuggestion` in
  `src/places.ts`. The search box already has the list, the 250 ms pause, stale-answer
  dropping, arrow keys and screen-reader roles; today `suggestPlaces` returns nothing, so
  the list only offers "search for this place" or "go to these coordinates". Fill in
  those two functions and nothing else changes. (Keep any key off the page.)
- **Moving the processing to the cloud.** Everything the page asks goes through
  `src/api.ts`; components never call `fetch`. The one thing computed in the browser is
  filtering the 723,108 loaded hotspots by day on the graphics card.
- **A forecast.** `src/forecast.ts`, described above.

## Two things that will bite you

- MapLibre's stylesheet is injected after `index.css`, so any rule of ours that overrides
  it needs the extra `.app` in front of it.
- MapLibre builds its worker URL at runtime, which no bundler can follow. `MapView.tsx`
  imports that worker with `?url` and sets `config.WORKER_URL`. Without it the base map
  is blank in a production build.
