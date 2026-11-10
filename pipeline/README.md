# UzHa data pipeline

Offline Python pipeline for the "Urban Heat Islands" web app. For each city, on a 200 m grid:
summer land-surface temperature (LST) and the contribution of each factor to it in °C
(XGBoost model, SHAP values).

Output is static JSON in `web/public/data/` following [`docs/data-contract.md`](../docs/data-contract.md).

## Run

From the project root (Python 3.10+):

```bash
pip install -r pipeline/requirements.txt
PYTHONUTF8=1 python -m pipeline.run --city tashkent   # one city
PYTHONUTF8=1 python -m pipeline.run --all             # tashkent, samarkand, bukhara
python -m pytest pipeline/tests -q
```

Population and social facilities are a separate light step that reads an existing `<id>.json`,
adds `cells.pop`, `population` and `facilities`, and writes it back (no satellite reads, no model):

```bash
PYTHONUTF8=1 python -m pipeline.run --city tashkent --only population
```

Summer weather at the city centre is another light step: it adds `city.weather` to `<id>.json`
and to the city's entry in `cities.json`:

```bash
PYTHONUTF8=1 python -m pipeline.run --city tashkent --only weather
```

A full run does both steps too, at the end.

`PYTHONUTF8=1` only matters on Windows, for Cyrillic in log output.

Downloads are cached in `pipeline/cache/<city>_<grid-hash>/` (gitignored); a rerun with the same
bbox takes about a minute. Delete a layer's `.pkl` to refetch it. A first run of Tashkent takes roughly
10–20 minutes, mostly Sentinel-2 reads. No API keys are needed.

## Sources

| Layer | Source | Notes |
|---|---|---|
| LST (target) | Landsat 8/9 C2 L2 `lwir11` (ST_B10), Planetary Computer | °C = DN·0.00341802 + 149 − 273.15; QA_PIXEL fill, dilated cloud, cloud, shadow masked; per-pixel median of up to 30 lowest-cloud scenes, Jun–Aug 2023–2025 (falls back to May–Sep, then 2021–2025, if fewer than 3 usable scenes); pixels with < 3 clear observations dropped |
| `ndvi`, `albedo` | Sentinel-2 L2A | cloud < 10 %, SCL mask (keeps dark area, vegetation, bare, water, unclassified), up to 10 scenes per MGRS tile, ranked by cloud % + no-data % (swath-edge items rarely cover the city), one per datatake; −1000 DN offset for processing baseline ≥ 04.00; albedo by Liang (2001); per-pixel median |
| `tree`, `built`, `bare` | ESA WorldCover 2021 (10 m) | share of the cell in classes 10 / 50 / 60, % |
| `water_dist` | WorldCover class 80 + OSM `natural=water`, `landuse=reservoir`, `waterway=river/canal` | mean Euclidean distance (10 m raster) from the cell's pixels to the nearest water, m |
| `elevation` | Copernicus DEM GLO-30 | mean, m |
| `roads` | OSM `highway=*` drivable classes (motorway … service, `_link`) | km per km² |
| `buildings` | OSM `building=*` (`out center`) | footprints per hectare |
| districts | OSM admin boundaries (`admin_level=6` inside the Tashkent city relation) | optional |
| `cells.pop` | WorldPop 2025, 100 m, constrained, UN-adjusted (R2025A), `uzb_pop_2025_CN_100m_R2025A_v1.tif` | downloaded once to `pipeline/cache/worldpop/`; windowed read over the grid; each pixel's count goes to the cell under its centre (sum), whole people |
| `facilities` | OSM `amenity=school/kindergarten/clinic/hospital` (nodes, way and relation centres) | only those inside a cell; `name:ru`, else `name`, else `name:uz` |
| `city.weather` | ERA5 hourly reanalysis (Copernicus) via the Open-Meteo historical API (`archive-api.open-meteo.com`, `models=era5`), no key | one grid point nearest the city centre, June–August 2023–2025, local time UTC+5; relative humidity from 2 m temperature and dew point (Magnus, Alduchov & Eskridge 1996); conditions at overpasses use the acquisition times of the Landsat candidates from the same STAC search as LST, rounded to the hour; cached in `pipeline/cache/weather/` |
| photo | ru.wikipedia REST page summary | lead image, credit "Wikipedia / Wikimedia Commons" |

OSM is queried through the Overpass API with the User-Agent `uzha-heat-pipeline/0.1`, cycling
overpass-api.de → overpass.kumi.systems → maps.mail.ru for 2 rounds with exponential backoff
(15 s doubling, capped at 4 min), each request capped at 180 s wall clock; a response with an Overpass "runtime error" remark counts as a
failure. Buildings are fetched in 3×3 bbox tiles. A factor whose source fails is dropped and the city is
still produced; `features` in the JSON lists only what is present. Failed downloads are not cached,
so rerunning the city retries them.

## Method

1. **Extent.** The bbox is the city's OSM boundary (`pipeline/boundaries/<city>.geojson`) grown
   by 1.5 km; cells whose centre lies farther than that outside the boundary are dropped. If the
   boundary file is missing, the bbox from `uzha/cities.py` is used and no cells are dropped.
2. **Grid.** The bbox is projected to its UTM zone and snapped to 200 m cells. Rasters are
   resampled with windowed COG reads + `rasterio.warp.reproject` onto a sub-grid of 7×7 pixels per
   cell (≈ 28.6 m, close to Landsat's 30 m; 30 m does not divide 200 m) — WorldCover onto
   20×20 (10 m) — and averaged back to cells.
3. **Cell filter.** A cell is kept if ≥ 50 % of its pixels have valid LST and every raster factor,
   water covers ≤ 50 % of it, and no factor is missing.
4. **Model.** `XGBRegressor` (400 trees, depth 5, lr 0.05, subsample/colsample 0.8,
   min_child_weight 10) predicts LST from the factors. Accuracy (`r2Cv`, `maeCv`) is
   out-of-fold over **spatial block CV**: cells are grouped into 2×2 km blocks and `GroupKFold(5)`
   holds whole blocks out, so neighbouring cells never leak between train and test.
5. **Explanation.** The final model is fit on all cells; per-cell SHAP values come from
   `booster.predict(..., pred_contribs=True)` (TreeSHAP, exact for trees). The bias column is
   `baseValue`; the pipeline asserts `sum(shap) + baseValue == prediction`. `globalImportance`
   is mean |SHAP| per factor, plus the Pearson correlation of the raw factor with LST.

## Limitations

- **LST is not air temperature.** It is the skin temperature of roofs, asphalt and soil at the
  ~10:30–11:00 local Landsat overpass; night-time heat is not captured.
- **SHAP explains the model, not physics.** Factors are correlated (NDVI vs tree cover, built vs
  buildings vs roads), so credit between them is split somewhat arbitrarily; read related factors
  together. Associations are not proven causes.
- Landsat's thermal band is 100 m native (USGS resamples it to 30 m), so a 200 m cell spans about
  two native thermal pixels; sharp edges (parks, canals) are blurred.
- OSM completeness varies by district (buildings especially); low building density can mean
  missing mapping.
- `water_dist` only sees water inside the grid, so cells near the edge may overestimate it.
- WorldCover is 2021; recent construction is not reflected.
- WorldPop is a modelled estimate: census totals spread over buildings by a model, not counted
  residents. It says where people sleep, not where they are at 11 am. A pixel on a cell edge goes
  wholly to one cell.
- Weather is one ERA5 point (~25 km) per city: it says how the cities' summers differ, not how
  wind or humidity vary between streets. The overpass values use the up-to-30 lowest-cloud Landsat
  candidates; a few of them were later dropped from the LST median as too cloudy over the city.
- The UTM-aligned cells are exported as centers plus a fixed half-size in degrees, so drawn squares
  are very slightly rotated/overlapping relative to the true cells.

## Layout

```
run.py              CLI: one city → <id>.json + update cities.json
boundaries/         OSM city boundaries (GeoJSON) that set each city's extent
uzha/cities.py      city registry (fallback bbox, names, Wikipedia title, OSM relation for districts)
uzha/boundary.py    bbox and cell mask from the boundary + margin
uzha/grid.py        UTM grid, sub-grid rasters, block aggregation
uzha/stac.py        Planetary Computer search, COG window read + reproject
uzha/cache.py       per-layer pickle cache
uzha/sources/       landsat, sentinel, worldcover, dem, osm, wiki, worldpop, era5
uzha/features.py    assemble the cell table, factor catalogue (labels/units)
uzha/model.py       XGBoost, spatial CV, SHAP, global importance
uzha/population.py  light step: people per cell and facilities into an existing city JSON
uzha/weather.py     light step: summer weather (ERA5) into an existing city JSON and cities.json
uzha/export.py      contract JSON (3-decimal values, 5-decimal coordinates)
tests/              pytest
```
