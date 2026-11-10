# Data contract: pipeline → web

The pipeline (Python, offline) writes static JSON into `web/public/data/`.
The web app (Vite + TypeScript + MapLibre) only reads these files. No backend at runtime.

## `web/public/data/cities.json`

```json
[
  {
    "id": "tashkent",
    "name": "Ташкент",
    "nameEn": "Tashkent",
    "country": "Узбекистан",
    "center": [69.2797, 41.3111],
    "bbox": [69.12, 41.20, 69.43, 41.42],
    "photo": { "url": "https://upload.wikimedia.org/...", "credit": "Wikimedia Commons" },
    "lstMean": 44.2,
    "r2": 0.74,
    "weather": {
      "source": "ERA5 (Copernicus) via Open-Meteo",
      "period": "июнь–август 2023–2025",
      "point": [69.25, 41.25],
      "summer": { "windMs": 1.9, "humidityPct": 42.5, "solarKwhM2": 7.3, "cloudPct": 15.3, "airMeanC": 27.1, "airMaxC": 34.3 },
      "overpass": { "days": 20, "localHour": 11, "windMs": 1.5, "humidityPct": 31.0, "solarWm2": 799, "cloudPct": 0.3, "airC": 32.0 }
    }
  }
]
```

## `web/public/data/<id>.json`

```json
{
  "city": { "...": "same object as in cities.json" },
  "period": { "label": "июнь–август 2023–2025", "lstScenes": 9, "s2Scenes": 6 },
  "grid": { "cellSizeM": 200, "halfSizeDeg": [0.0012, 0.0009], "count": 14250 },
  "features": [
    { "key": "ndvi", "label": "Растительность", "unit": "NDVI", "description": "..." }
  ],
  "model": { "type": "XGBoost", "r2Cv": 0.74, "maeCv": 1.1, "cv": "spatial block 5-fold", "baseValue": 44.2 },
  "stats": { "lstMean": 44.2, "lstMin": 31.0, "lstMax": 56.3, "lstP10": 39.1, "lstP90": 49.0 },
  "globalImportance": [
    { "key": "ndvi", "meanAbsShap": 1.9, "correlation": -0.71 }
  ],
  "cells": {
    "lon": [69.12],
    "lat": [41.20],
    "lst": [45.1],
    "values": { "ndvi": [0.12] },
    "shap":   { "ndvi": [1.3] },
    "pop": [412],
    "energy": { "sAbs": [640], "rn": [430], "g": [105], "h": [250], "le": [75] }
  },
  "energy": {
    "localHour": 11, "solarWm2": 799, "airC": 32.0, "humidityPct": 31.0, "longwaveDownWm2": 395,
    "hotAnchorC": 52.5, "coldAnchorC": 32.4,
    "mean": { "sAbs": 627, "rn": 455, "g": 103, "h": 189, "le": 162 },
    "surfaces": [
      { "key": "asphalt", "label": "Асфальт", "heatCapacity": 1.94, "conductivity": 0.75, "admittance": 1205 }
    ]
  },
  "population": { "source": "WorldPop 2025, 100 м, constrained, R2025A", "year": 2025, "total": 2633011 },
  "facilities": [
    { "name": "Школа № 110", "type": "school", "lon": 69.24051, "lat": 41.31112 }
  ],
  "districts": [
    { "name": "Юнусабадский район", "geometry": { "type": "Polygon", "coordinates": [] },
      "lstMean": 43.0, "cellCount": 900, "shapMean": { "ndvi": 0.4 } }
  ]
}
```

### Rules
- Columnar arrays: index `i` is the same cell in every array. Floats rounded to 3 decimals,
  except coordinates (`cells.lon`/`lat`, district geometry: 5 decimals, ~1 m) and
  `grid.halfSizeDeg` (6 decimals) — 3 decimals of a degree (~100 m) is too coarse for 200 m cells.
- `lst` is mean summer land-surface temperature, °C (median of clear-sky Landsat 8/9 scenes).
- `shap[key][i]` is in °C: contribution of factor `key` to the cell's temperature relative to
  `model.baseValue`. Positive = this factor heats the cell, negative = cools it.
- `globalImportance` is sorted by `meanAbsShap` desc. `correlation` = Pearson(feature, lst).
- `height` is metres (not rounded to 10 m like distances); `volume` is m³ of buildings per hectare.
- Area-share factors (`tree`, `built`, `bare`) are percent of the cell area, 0–100 (not 0–1 fractions).
- `districts` is optional (may be absent or empty).
- `cells.pop` is optional: people living in the cell, whole numbers, from the WorldPop 100 m
  population grid (a modelled estimate, not a census). When present, `population` is present too,
  with `total` = sum of `cells.pop`.
- `facilities` is optional: schools, kindergartens, clinics and hospitals from OpenStreetMap
  (`amenity` = `school` | `kindergarten` | `clinic` | `hospital`) that fall into one of the cells.
  `name` may be an empty string. Coordinates have 5 decimals.
- `city.weather` is optional, and when present it is the same object in `cities.json` and in `<id>.json`.
  It is summer weather at one ERA5 grid point (`point`, lon/lat, ~25 km cell) nearest the city centre,
  so it compares cities and is not a model factor. `summer`: means over every hour of June–August
  2023–2025: 10 m wind speed (m/s), relative humidity at 2 m from temperature and dew point (%, Magnus formula),
  cloud cover (%), 2 m air temperature (°C); `airMaxC` is the mean of daily maxima (local days, UTC+5);
  `solarKwhM2` is the mean daily total of surface solar radiation downwards (kWh/m²).
  `overpass` is optional: the same values at the hours of the Landsat scenes the LST median was drawn
  from (`days` distinct overpasses, `localHour` their mean local hour), with `solarWm2` the hourly mean in W/m².
  Values have 1 decimal (`solarWm2` is whole).
- `cells.energy` is optional: the surface energy balance of each cell at the Landsat overpass
  (about 11:00 local), whole W/m². `sAbs` absorbed sunlight, `rn` net radiation, `g` heat flux into
  the ground and the built fabric, `h` sensible heat (heating the air), `le` latent heat (evaporation).
  `rn` = `g` + `h` + `le` exactly. All five arrays are present together, and then the top-level
  `energy` is present too, with the inputs of the method: `solarWm2`, `airC`, `humidityPct` and
  `localHour` copied from `city.weather.overpass`, clear-sky `longwaveDownWm2`, the hot and cold
  anchor surface temperatures (°C, 1 decimal) that set the evaporative fraction, the city `mean` of
  each flux, and `surfaces`: reference thermal properties (`heatCapacity` MJ m⁻³ K⁻¹, `conductivity`
  W m⁻¹ K⁻¹, `admittance` J m⁻² s⁻½ K⁻¹) of `asphalt`, `concrete`, `dry_soil`, `wet_soil`, which are
  for explanation only and are not per-cell values. Formulas and sources: `pipeline/README.md`.
- `features` lists only the factors actually present; the web app must iterate it and never hardcode
  which keys exist.

## Factor keys (fixed vocabulary)

| key | label | unit | source |
|---|---|---|---|
| `ndvi` | Растительность | NDVI | Sentinel-2 L2A, summer median |
| `tree` | Древесный покров | % площади | ESA WorldCover 2021, class 10 |
| `built` | Застройка | % площади | ESA WorldCover 2021, class 50 |
| `bare` | Открытый грунт | % площади | ESA WorldCover 2021, class 60 |
| `albedo` | Отражающая способность | albedo 0–1 | Sentinel-2, Liang (2001) broadband |
| `roads` | Плотность дорог | км/км² | OpenStreetMap highways |
| `buildings` | Плотность зданий | шт/га | OpenStreetMap buildings |
| `height` | Высота зданий | м | mean building height in the cell: OSM `height`, else `building:levels` × 3 m; buildings without either, and cells without OSM buildings, take GHSL Built-H 2018 (ANBH) weighted by built-up share; 0 where nothing is built |
| `volume` | Объём застройки | м³/га | GHSL Built-S 2020 built-up share of the cell × `height` × 10 000 m²/ha |
| `water_dist` | Удалённость от воды | м | ESA WorldCover class 80 + OSM water |
| `elevation` | Высота | м | Copernicus DEM GLO-30 |
