# Data source adapters

One file per source (`firms.ts`, `open-meteo.ts`, `infobanjir-rain.ts`, ...). Each exports `fetch()`
returning normalized records and ships a `mock.json` fallback, plus a cache, timeout and retry.
Implemented in Phase 3.
