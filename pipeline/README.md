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

The surface energy balance is a third light step. It needs `city.weather.overpass`, so run it after
`--only weather`; it adds `cells.energy` and `energy` and makes no downloads:

```bash
PYTHONUTF8=1 python -m pipeline.run --all --only energy
```

A full run does all three steps too, at the end.

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
| `height` | OSM `height` / `building:levels` × 3 m (same building query, tags), gaps from GHSL Built-H 2018 ANBH, 3″ (JRC) | per building: its OSM height if tagged (2–300 m), else the cell's GHSL height (ANBH weighted by GHSL built-up share); cell = mean over its OSM buildings, or the GHSL height where OSM has none |
| `volume` | GHSL Built-S 2020, 3″ (JRC) × `height` | built-up share of the cell × height, m³/ha; GHSL tiles (10°, ~10–15 MB zip each) downloaded once to `pipeline/cache/ghsl/` and read through `/vsizip/` |
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

## Surface energy balance

For each cell at the Landsat overpass (about 11:00 local), from data already in the city JSON
(`lst`, `albedo`, `ndvi`) and the ERA5 means at the overpass hours (`solarWm2`, `airC`, `humidityPct`).
Code: `uzha/energy.py`. All fluxes in W/m²: `g` positive into the ground, `h` and `le` positive into the air.

| Step | Formula | Source |
|---|---|---|
| Absorbed sunlight | S_abs = (1 − α)·S↓ | α: Sentinel-2 broadband albedo (Liang 2001); S↓: ERA5 surface solar radiation downwards |
| Surface emissivity | NDVI < 0.2: ε = 0.97; NDVI > 0.5: ε = 0.99; between: ε = 0.99·Pv + 0.97·(1 − Pv) + (1 − 0.97)(1 − Pv)·0.55·0.99, Pv = ((NDVI − 0.2)/0.3)² | NDVI threshold method, Sobrino, Jiménez-Muñoz & Paolini (2004), [doi:10.1016/j.rse.2004.02.003](https://doi.org/10.1016/j.rse.2004.02.003) |
| Longwave from the surface | L↑ = ε·σ·Ts⁴, Ts = LST in K, σ = 5.670·10⁻⁸ W m⁻² K⁻⁴ | Stefan–Boltzmann |
| Longwave from the sky | L↓ = ε_a·σ·Ta⁴, ε_a = 1.24·(e_a/Ta)^(1/7), e_a in hPa = RH·6.1094·exp(17.625·T/(T + 243.04)) | clear sky, Brutsaert (1975), [doi:10.1029/WR011i005p00742](https://doi.org/10.1029/WR011i005p00742); Magnus, Alduchov & Eskridge (1996), [doi:10.1175/1520-0450(1996)035<0601:IMFAOS>2.0.CO;2](https://doi.org/10.1175/1520-0450(1996)035%3C0601:IMFAOS%3E2.0.CO;2) |
| Net radiation | Rn = S_abs + ε·L↓ − L↑ (the surface absorbs ε of L↓ and reflects the rest) | e.g. Allen, Tasumi & Trezza (2007) METRIC, [doi:10.1061/(ASCE)0733-9437(2007)133:4(380)](https://doi.org/10.1061/(ASCE)0733-9437(2007)133:4(380)) |
| Ground heat flux | G = Rn·Ts·(0.0038 + 0.0074·α)·(1 − 0.98·NDVI⁴), Ts in °C | SEBAL, Bastiaanssen (2000), [doi:10.1016/S0022-1694(99)00202-4](https://doi.org/10.1016/S0022-1694(99)00202-4) |
| Evaporative fraction | EF = (T_hot − Ts)/(T_hot − T_cold), clipped to 0..1. T_hot: mean LST of the 5 % hottest among the 10 % least green cells; T_cold: mean LST of the 5 % coldest among the 10 % greenest | hot/cold anchors as in SEBAL, Bastiaanssen et al. (1998), [doi:10.1016/S0022-1694(98)00253-4](https://doi.org/10.1016/S0022-1694(98)00253-4); linear EF in temperature as in S-SEBI, Roerink, Su & Menenti (2000), [doi:10.1016/S1464-1909(99)00128-8](https://doi.org/10.1016/S1464-1909(99)00128-8) and SSEB, Senay et al. (2007), [doi:10.3390/s7060979](https://doi.org/10.3390/s7060979) |
| Evaporation and heating | LE = EF·(Rn − G), H = Rn − G − LE | energy closure |

`rn`, `g`, `le` are rounded to whole W/m² and `h` is taken as `rn − g − le`, so the balance closes
exactly in the JSON. The tests check closure and that midday Rn stays within 300–700 W/m².

Heat storage is explained, not computed per cell. Reference values from Oke (1987) *Boundary Layer
Climates*, 2nd ed., Table 2.1 ([doi:10.4324/9780203407219](https://doi.org/10.4324/9780203407219)); the
role of admittance in urban heat storage: Oke, Mills, Christen & Voogt (2017) *Urban Climates*,
ch. 6 ([doi:10.1017/9781139016476](https://doi.org/10.1017/9781139016476)):

| Surface | Heat capacity C, MJ m⁻³ K⁻¹ | Conductivity k, W m⁻¹ K⁻¹ | Admittance μ = √(kC), J m⁻² s⁻½ K⁻¹ |
|---|---|---|---|
| Asphalt | 1.94 | 0.75 | 1205 |
| Concrete (dense) | 2.11 | 1.51 | 1785 |
| Dry sandy soil | 1.28 | 0.30 | 620 |
| Saturated sandy soil | 2.96 | 2.20 | 2550 |

A surface with high admittance takes heat deep into itself by day and gives it back after sunset.
Asphalt and concrete do that two to three times better than dry soil, which is why built-up cells stay
warm in the evening. Wet soil under irrigated greenery also stores a lot, but it spends the day's
energy on evaporation first, so it starts the evening cooler.

**Simplifications.** One model, one moment: the median summer LST against the mean ERA5 weather at
the overpass hours. ERA5 is one ~25 km point per city, so S↓, air temperature and humidity are the
same for every cell. L↓ assumes a clear sky (the overpasses are at < 1 % cloud). Emissivity comes from
NDVI only: the soil value 0.97 is used for asphalt and roofs too (real ones are about 0.90–0.95), which
puts L↑ a little high and Rn a little low on built-up cells. SEBAL's G/Rn was fitted over natural
surfaces; in dense blocks heat storage at midday can reach 30–40 % of Rn, more than this gives. The
evaporative fraction is relative to the city's own hottest and coolest cells: the hot anchor is taken
to evaporate nothing and the cold anchor to evaporate as much as it can, so `le` compares places within
a city better than it compares cities. Shading by buildings and trees and the wind are not in the model.

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
uzha/energy.py      light step: surface energy balance per cell from LST, albedo, NDVI and the overpass weather
uzha/export.py      contract JSON (3-decimal values, 5-decimal coordinates)
tests/              pytest
```
