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
npx vitest run     # unit tests
npm run build      # type check and production build
```

## Layout

| Path | What it holds |
| --- | --- |
| `src/types.ts` | Every response shape, copied from the handoff. The only place to update if the backend changes one. |
| `src/api.ts` | One function per endpoint, each with a mock twin chosen by `VITE_USE_MOCKS`. Nothing else calls `fetch`. |
| `src/mocks/` | The mock twins, derived from the loaded hotspots. |
| `src/map/` | MapLibre + deck.gl: the dots, the colour ramp, the typed arrays. |
| `src/components/` | The panels and controls floating over the map. |
| `src/lib/` | Dates, months, distances, coordinate parsing. |

## Decisions worth knowing

- **No API keys anywhere.** Base map: CARTO's dark style (free, no key). Place search:
  Nominatim (free, no key). A key used in a browser is visible to everyone, so nothing
  secret can live here; the NASA key stays on the server.
- **All 723,108 dots are drawn at once** by deck.gl on the graphics card. The time slider
  filters on the card through `DataFilterExtension`, so the data is never rebuilt and the
  animation stays smooth.
- **Colour means intensity**, on the "inferno" ramp, which rises steadily from dark to
  light and so survives every kind of colour blindness. Stronger fires are also drawn
  larger, so colour is never the only signal.
- **Raw counts before and after February 2012 are never compared.** A sharper camera took
  over then. The notice by the slider and the break in the yearly chart both say so.
- **The video export writes its own overlays.** Overlays drawn as HTML are not part of
  the map's canvas, so the date, legend, 2012 notice and credits are painted into each
  frame (`src/map/videoFrame.ts`). The map is created with `preserveDrawingBuffer` for
  this to capture anything.

## Two things that will bite you

- MapLibre's stylesheet is injected after `index.css`, so any rule of ours that overrides
  it needs the extra `.app` in front of it.
- MapLibre builds its worker URL at runtime, which no bundler can follow. `MapView.tsx`
  imports that worker with `?url` and sets `config.WORKER_URL`. Without it the base map
  is blank in a production build.
