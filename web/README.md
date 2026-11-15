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

Against the real server (start it from the repo root first, see the root README):

```
VITE_USE_MOCKS=false npm run dev
```

`/api` is proxied to `http://localhost:8000` in development; in production the server
serves the built page from the same origin, so the page never needs a host name.

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
