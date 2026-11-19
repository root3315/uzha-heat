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

## `web/public/data/model-<id>.json`

The city's final XGBoost model, for "что если" in the browser. Loaded only when the reader opens that block.

```json
{
  "format": "uzha-xgb-1",
  "features": ["ndvi", "tree", "built"],
  "baseScore": 43.6,
  "trees": [{ "feature": [0, -1, -1], "value": [0.31, 0.42, -0.2], "left": [1, -1, -1], "defaultLeft": [1, 0, 0] }],
  "check": { "rows": [[0.12, 0, 88]], "prediction": [47.1234] }
}
```

- A row is the cell's values in `features` order. Prediction = `baseScore` + one leaf per tree.
- In a tree, node 0 is the root. `feature` −1 marks a leaf, whose value is in `value`; otherwise go to
  `left` when x < `value` (compared as float32), else to `left + 1`; a missing x goes left when `defaultLeft` is 1.
- `check`: sample cells and the booster's own predictions (°C), to verify an evaluator to 1e-5.

## `web/public/data/physics.json`

Optional. The physics model (a per-tile surface energy balance, `pipeline/uzha/seb/`) per city, written by
`python -m pipeline.seb_check --all`. The method page shows its section only when the file and the city are present.

```json
{
  "tashkent": {
    "skill": {
      "physics": { "r2": 0.31, "mae": 2.1, "bias": -0.1 },
      "hybrid": { "r2": 0.7, "mae": 1.3, "bias": 0.0 },
      "inside": { "physics": { "r2": 0.2, "mae": 1.9, "bias": 0.1 }, "hybrid": { "r2": 0.6, "mae": 1.2, "bias": 0.0 } }
    },
    "params": { "kb_inv": 6.44, "rs_min_tree": 40.0, "d_t_air": 4.61 },
    "converged": 0.998,
    "fluxes": {
      "inside": { "rn": 520.3, "h": 260.1, "le": 110.4, "dqs": 170.2, "qf": 20.4 },
      "ring": { "rn": 500.0, "h": 220.0, "le": 160.0, "dqs": 125.0, "qf": 5.0 }
    },
    "budget": {
      "observed": 1.9,
      "groups": [{ "id": "albedo", "contribution": 0.2 }],
      "other": 0.4, "modelGap": 0.3, "referenceState": 0.1, "model": 1.6,
      "sample": { "inside": 1500, "ring": 1500, "cellsInside": 15780, "cellsRing": 4666 },
      "efficiencyK": 1e-12
    },
    "scenarios": [
      { "id": "cool_roofs", "treatedDT": [-4.1, -3.6, -3.2], "wholeDT": [-0.9, -0.8, -0.7], "areaShare": 0.25,
        "settings": { "albedo": 0.55, "emissivity": null },
        "assumptions": [{ "id": "albedo", "text": "Every treated roof reaches albedo 0.55 (aged coating, not fresh)." }] }
    ],
    "replicates": 10,
    "interval": [5, 95]
  }
}
```

- Temperatures and their changes are in K (= °C for differences). `bias` is model − observed.
- `skill`: out of fold on 2 km blocks (5 folds), the same check as the main model's `r2Cv`. `physics` is the energy
  balance alone, `hybrid` the energy balance plus a small XGBoost correction trained on the published factors; `inside`
  repeats both for the cells inside the city outline only.
- `params`: the seven calibrated parameters (`pipeline/uzha/seb/types.py`, `Params`), fitted on all cells.
  `converged`: share of cells where every tile's balance closed.
- `fluxes`: mean cell flux, W/m², inside the outline and in the ring: net radiation `rn`, sensible `h`, latent `le`,
  storage `dqs`, anthropogenic `qf`. `rn + qf = h + le + dqs` up to the solver tolerance.
- `budget`: city minus ring, area-weighted means (theory Eq. 60–63). `groups` are exact Shapley contributions over the
  8 factor groups (`albedo`, `shade`, `transpiration`, `sealing`, `geometry`, `storage`, `anthropogenic`, `water`), each
  reset to the ring's median; `observed = Σ groups + other`. `other = modelGap + referenceState`: what the model misses
  (observed − modelled contrast) plus what stays when every group is at the ring's value (the forcing and inputs no group
  owns). Computed on a stratified sample (`sample`: cells drawn per side, evenly across LST quintiles, each weighted by
  the cells it stands for), so `observed` is the sample's estimate. `efficiencyK` is the largest per-cell gap between Σ φ
  and T(all observed) − T(all at reference).
- `scenarios`: one entry per scenario id (`cool_roofs`, `cool_pavements`, `trees`, `green_roofs`, `permeable`,
  `waste_heat`), applied to every eligible cell inside the outline. `treatedDT`: mean change on the treated surfaces;
  `wholeDT`: mean change of the cell temperature over all cells inside; each `[low, estimate, high]`, the estimate with
  the final parameters, low/high the `interval` percentiles over `replicates` parameter sets refitted on block-bootstrap
  resamples (widened to include the estimate). `treatedDT` is null when nothing was treated. `areaShare`: share of the
  city's area treated. `settings`: the scenario's parameters (`pipeline/uzha/seb/scenarios.py`; null = left as
  observed). `assumptions`: `{id, text}` in English; the site words the known ids itself in each language from
  `settings` and shows the file's text for any other id.

## `web/public/data/night-<id>.json`

The summer night surface temperature around the city from NASA MODIS Aqua (MYD11A2, band `LST_Night_1km`, about
01:30 local), for the map's night layer. Optional: without the file the layer is not offered. Written by
`python -m pipeline.night --all` from the same summer 8-day composites as `pipeline/validate.py` (and its cache).

```json
{
  "format": "uzha-night-1",
  "product": "MYD11A2",
  "band": "LST_Night_1km",
  "overpassLocal": "~01:30",
  "period": "июнь–август 2023–2025",
  "composites": 25,
  "minComposites": 5,
  "grid": { "projection": "sinusoidal", "radiusM": 6371007.181, "x0": 5748784.185, "y0": 4614594.658,
            "pixelM": 926.625433, "nx": 94, "ny": 50 },
  "bounds": [68.58996, 41.08333, 70.07535, 41.5],
  "stats": { "min": 15.5, "median": 18.1, "max": 22.8 },
  "values": [18.6, null, 18.1]
}
```

- The pixels are MODIS's own 1 km pixels on its sinusoidal grid, not resampled. `x0`, `y0` are the grid's top-left
  corner in sinusoidal metres, `pixelM` the pixel size; pixel (`col`, `row`) spans `x0 + col·pixelM … + pixelM` and
  `y0 − row·pixelM … − pixelM`. To lon/lat (radians, sphere of radius `radiusM`): lat = y / R, lon = x / (R cos lat).
  In lon/lat the pixels are slightly sheared quadrilaterals; draw them as they are, do not smooth.
- `values`: `nx × ny` numbers, row-major from the north-west corner, °C with 1 decimal. `null` where the pixel had
  fewer than `minComposites` good composites (QC as in the MODIS check), or where its centre is outside the lon/lat
  box of the city outline grown by 8 km, the area MODIS is fetched for (the sinusoidal box around it is a sheared
  parallelogram in lon/lat, reaching tens of kilometres past the city).
- `bounds` is [west, south, east, north] of the whole grid in degrees; `stats` are over the non-null values.
- `period` is the Landsat period of `<id>.json` (Russian, as there); `composites` the 8-day periods found in it.

## `web/public/data/seb-<id>.json`

Optional. The physics model's inputs for every cell, so the place panel can solve the picked cell's energy balance in
the browser ("Surfaces (physics)": roof and road albedo, green roofs). Written by `python -m pipeline.seb_export`
from the inputs of `pipeline/uzha/seb/inputs.py` and the `params` of `physics.json` (run `seb_check` first); only
for cities in `physics.json`, and the site offers the block only for those. Fetched only when the reader opens it.

```json
{
  "format": "uzha-seb-1",
  "tiles": ["tree", "grass", "bare", "roof", "road", "paved", "water"],
  "cells": 20446,
  "params": { "kbInv": 6.44, "rsMinTree": 40.0, "rsMinGrass": 34.1, "rsMinCrop": 20.6, "soilResistanceScale": 0.49,
              "ohmA1Scale": 1.2, "dTAir": 4.61 },
  "forcing": { "kDown": 840.5, "diffuseFraction": 0.16, "eAir": 1.45, "wind": 2.13, "zRef": 60.0, "zenith": 0.527,
               "dkDt": 66.7, "tAir": { "offset": 304.27, "step": 0.01, "values": [12, 140] }, "lDown": {}, "pressure": {} },
  "tile": {
    "emissivity": [0.98, 0.95, 0.93, 0.91, 0.95, 0.9, 0.96],
    "ohm": [[0.11, 0.11, -12.3], [0.32, 0.54, -27.4]],
    "albedo": { "tree": 0.16, "grass": 0.21, "bare": 0.25, "water": 0.08 },
    "imperviousTiles": ["roof", "road", "paved"],
    "canyonTiles": ["road", "paved", "grass", "bare"]
  },
  "cell": {
    "fraction": { "tree": { "offset": 0.0, "step": 0.001, "values": [120, 0] }, "bare": 0.0 },
    "imperviousAlbedo": {}, "canyonShade": {}, "skyView": {}, "z0m": {}, "zd": {}, "soilMoisture": 0.214,
    "qf": {}, "irrigated": { "offset": 0.0, "step": 1.0, "values": [1, 0] }, "rural": {}
  },
  "check": { "cells": [12545, 115], "tCell": [309.911523, 309.060631] },
  "roundingK": 0.0345
}
```

- A column is either one number (the same for every cell) or `{offset, step, values}`: one integer per cell in the
  order of `<id>.json`'s `cells`, value = `offset + step × int`. Steps: tile shares 0.001 (each cell's shares sum to
  exactly 1000 steps), albedo, shade, sky view and soil moisture 0.001, `z0m` 0.00001 m, `zd` 0.01 m, `qf` 0.1 W/m²,
  `tAir` 0.01 K, `lDown` 0.1 W/m², `pressure` 0.01 kPa. `irrigated` and `rural` are 0/1.
- Names and units are those of the solver (`web/src/domain/seb/types.ts`, `pipeline/uzha/seb/types.py`): `params` are
  the seven calibrated parameters; `forcing` the overpass weather, one value for the city except the air temperature,
  incoming longwave and pressure, which follow the cell's elevation (K, W/m², kPa; `zenith` in rad, `dkDt` W m⁻² h⁻¹).
- `tile`: what does not vary by cell, in `tiles` order. Albedo: the natural tiles have one value for the city
  (`albedo`), the `imperviousTiles` share the cell's `imperviousAlbedo`. Shade: the `canyonTiles` share the cell's
  `canyonShade`, the other tiles are unshaded.
- `check`: built-up cells (roofs and roads at least 1 % each) spread over the cell temperature, and two ring cells,
  with the Python solver's radiance-weighted cell temperature (K) on exactly these decoded inputs; a port must
  reproduce it to 1e-5 K. `roundingK`: the largest change of a converged cell's temperature that the rounding causes.

## Language

The texts in the files (`label`, `description`, `unit`, `period`, `weather.period`, district names) are Russian.
The web app opens in English and keeps the English for this fixed vocabulary itself, in
`web/src/domain/dataTexts.ts` (labels and descriptions by factor key, surfaces by key, Tashkent's districts,
month names) and `web/src/domain/format.ts` (units); city names come from `nameEn`. A new factor key, surface
or district needs its English there, otherwise English pages show the Russian text from the file.

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
