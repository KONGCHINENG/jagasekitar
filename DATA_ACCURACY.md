# Improving flood and haze accuracy

What to add, in order of value for effort. "Checked" means we called the endpoint on 2026-10-17 and it answered
without a key.

## Status (2026-10-18)

| #      | Item                                          | Status                                                                                            |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1      | NASA FIRMS key                                | ✅ Live: ~12,000 hotspots per run                                                                 |
| 2      | MetMalaysia warnings                          | ✅ `metmalaysia` source → district-wide flood zones                                               |
| 3      | GloFAS river discharge                        | ✅ `glofas` source, judged against 2/5/20-year return periods (not the recent median: see README) |
| 5      | Measured air quality                          | ✅ `waqi` source live: 19 stations; official monitors over 35 µg/m³ add "now" zones               |
| 4, 6–8 | Soil moisture, mixing height, AOD, visibility | Not started                                                                                       |

## Quick wins (free, no new accounts or a free key, mostly a new worker adapter)

| #   | Hazard | Add                                                                          | Why it helps                                                                                       | Source                                                                                   |
| --- | ------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Haze   | **Real NASA FIRMS key** (VIIRS NOAA-20/21 + S-NPP, MODIS)                    | Fire data is still mock. Nothing else matters as much for haze.                                    | Free `MAP_KEY` at firms.modaps.eosdis.nasa.gov → `FIRMS_MAP_KEY` in `.env`               |
| 2   | Flood  | **MetMalaysia weather warnings** (heavy rain, thunderstorm, continuous rain) | Official warning by district; raise flood risk when one covers a zone, like JPS alerts do.         | `https://api.data.gov.my/weather/warning/` (checked; note the trailing slash)            |
| 3   | Flood  | **River discharge forecast** (GloFAS, up to 30 days)                         | Forecasts river flow, not just rain; catches floods driven by upstream rain days ahead.            | Open-Meteo Flood API `flood-api.open-meteo.com/v1/flood?daily=river_discharge` (checked) |
| 4   | Flood  | **Soil moisture** (antecedent wetness)                                       | The same rain floods saturated ground much faster. Use as a multiplier on rain scores.             | Open-Meteo `hourly=soil_moisture_0_to_1cm,…` (checked)                                   |
| 5   | Haze   | **Measured air quality** (DOE APIMS stations)                                | Ground truth to correct the model's PM2.5 and to show "measured" next to "predicted".              | WAQI/aqicn free token (aggregates DOE stations), or OpenAQ free key                      |
| 6   | Haze   | **Boundary-layer height + rain washout**                                     | Smoke trapped under a low mixing layer is far worse; rain removes it. The puff model ignores both. | Open-Meteo `hourly=boundary_layer_height,precipitation` (checked)                        |
| 7   | Haze   | **Aerosol optical depth**                                                    | Satellite-assimilated (CAMS) column smoke; confirms or rejects a modelled plume.                   | Open-Meteo air quality `hourly=aerosol_optical_depth` (checked)                          |
| 8   | Haze   | **Airport visibility** (Ipoh WMKI, Sitiawan WMBA, Penang WMKP)               | Visibility below ~5 km without rain is a cheap, hourly, real haze signal.                          | aviationweather.gov `api/data/metar?ids=WMKI&format=json` (checked)                      |

## Medium effort (one-off data work, then it pays off every forecast)

**Flood**

- **Exact station coordinates and danger levels.** Pin every JPS station in Admin → Stations, using the JPS station
  pages. Some coordinates are approximate now. Store each station's alert, warning and danger levels in metres, then
  score "metres below danger" and "rise per hour" instead of only the status word.
- **River network and catchments** (HydroRIVERS and HydroBASINS, free). Link each rain station to the river reaches
  downstream of it. Then heavy rain upstream raises risk where the water will arrive, not only around the gauge.
- **Elevation and "height above nearest drainage"** (Copernicus GLO-30 or FABDEM, both free DEMs). Clip flood zones to
  low ground near rivers, instead of drawing round buffers that also cover hills.
- **Known flood-prone areas.** Use the JPS/NAHRIM flood hazard maps where you can get them, and past flood extents from
  Copernicus EMS or the GFM Sentinel-1 flood archive (2014, 2021 events). Raise the base risk inside them.
- **Tides for coastal districts** (Manjung, Hilir Perak, Kerian). A high tide plus heavy rain blocks drainage. Open-Meteo
  Marine API gives a sea-level forecast.

**Haze**

- **Peatland map.** Peat fires smoulder for weeks and produce far more smoke per hotspot. Weight hotspots on peat higher,
  and keep fires that persist over several days.
- **Fire emissions instead of raw FRP** (CAMS GFAS). It turns fire radiative power into smoke mass per fire.
- **More wind levels** (925 / 850 / 700 hPa). Smoke travels at different heights, so using several levels and averaging
  them is more robust than using one.
- **ASMC regional outlooks** (ASEAN Specialised Meteorological Centre). The authoritative hotspot counts and haze
  outlook for the region; show them as context and use them to sanity-check the model.

## Larger (makes the numbers trustworthy)

- **Backtesting.** Replay past periods (the September 2019 haze, December 2021 floods) through the engines. Score hits,
  misses and false alarms. Then tune the thresholds in Admin → Thresholds from evidence instead of guesses.
- **A daily calibration loop.** Compare yesterday's predictions with what was measured (DOE PM2.5, JPS river levels).
  Track the bias and adjust the haze decay/spread and the flood weights automatically, within limits admins set.
- **Ground reports.** Let users send "flooded here" or "smoky here" with a photo. Have a moderator confirm it, then use
  it as a strong local signal and as validation data.
- **Satellite flood mapping** (Sentinel-1 radar sees through cloud). Show water seen from space during an event.
- **Low-cost sensors** (sensor.community, PurpleAir) for neighbourhood-level PM2.5 between DOE stations.

## Ask first

These have usage limits or terms to check before relying on them: WAQI and OpenAQ (free tiers, attribution), OSM
France tiles (volunteer-run; for a public launch, move to a paid or self-hosted tile service), and anything with
commercial terms, such as Esri tiles and PurpleAir.
