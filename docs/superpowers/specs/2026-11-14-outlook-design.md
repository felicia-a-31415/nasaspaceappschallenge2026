# Risk outlook (`/api/outlook`) design

Short design. Approved in conversation on 14 November 2026.

## Intent

The team wanted to "predict fires". A spread forecast is not realistic by Sunday, and a wrong one shown to emergency responders is worse than none. The outlook is the honest version: for one place, how fire-prone the next two weeks usually are, nudged by what is happening there right now. It is labelled "Outlook from past seasons and recent weather", never "prediction".

- Goal: one level (`low`, `usual`, `high`) for the selected circle and the 14 days after a chosen day, with plain-sentence reasons.
- Non-goals: where a fire will spread, a probability, a map overlay of risk.
- Anti-goal: a level that cannot be explained. Every step up or down has a reason sentence.

## Approaches considered

1. **History, plus one step for recent weather and recent fire (picked).** Simple, explainable, uses two NASA datasets (FIRMS, POWER).
2. History only. Simpler, but it is just "the season", and it ignores the team's ask that recent conditions matter.
3. A fitted model (for example, logistic regression on weather against fire). This cannot be validated properly in the time left, and it is harder to explain to judges.

## Design

`GET /api/outlook?lat&lon&radius_km&on=YYYY-MM-DD`. `on` defaults to the table's `data_through`. It lets the demo ask "as of 1 June 2023".

- **Window:** the 14 days after `on`. **Recent:** the 14 days up to and including `on`.
- **History** uses VIIRS years only (2012 to the year before `on`), because the MODIS correction is valid only for a month or longer. For each past year, it takes the same window, counts VIIRS burning square-days in the circle, and does the same for the recent 14 days. History needs at least 5 years, or no level is given.
- **Base level:**
  - Fire in this window in fewer than a third of past years: `low`.
  - Otherwise, past years' fire in this window adds up to at least twice an even share of their yearly totals (total × 14 / 365): `high`, meaning peak season. Sums, not medians, are used because fire comes in bursty years and a median is usually 0 at circle size (found on the live data).
  - Otherwise: `usual`.
- **One step up** when recent fire is above usual (at least 2 × the median for those 14 days, and at least 3) or recent weather is dry. Dry means 30-day rain under half of usual, or under usual with average maximum temperature at least 2 °C above usual.
- **One step down** when 30-day rain is over 1.5 × usual.
- Steps combine: net change limited to one step, level kept within `low` to `high`.
- **Never raised** when no past year had fire in the window, so a winter week is not turned into "high".
- **Weather** comes from NASA POWER daily (existing `server.weather.daily`, cached). It needs at least 20 valid days in the 30-day stretch, or weather is reported as unavailable and left out.
- **Outside Quebec:** the same rules on the on-demand place's table. While a place is still fetching, the level is null with a sentence.

Response:

```json
{"coverage": "preloaded", "detail": null, "label": "Outlook from past seasons and recent weather",
 "as_of": "2023-06-01", "window": {"from": "2023-06-02", "to": "2023-06-15"},
 "level": "high", "reasons": ["..."],
 "history": {"years": 11, "years_with_fire": 9, "median_activity": 4.0, "season_factor": 2.3},
 "recent": {"activity": 12.0, "usual": 3.0},
 "weather": {"rain_mm": 10.2, "usual_rain_mm": 80.0, "temp_max_c": 25.1, "usual_temp_max_c": 22.0}}
```

`level`, `history`, `recent` are null when there is too little history; `weather` is null when unavailable.

## Left to the builder

Code lives in `server/outlook.py` (pure functions) plus one endpoint in `server/app.py`; tests go in `tests/test_outlook.py`.
