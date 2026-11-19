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

Buildings for the 3D view are a separate step with its own downloads (Geofabrik extract of Uzbekistan,
~130 MB; Microsoft ML footprints, ~45 MB per level-9 quadkey; the GHSL Built-H tile):

```bash
PYTHONUTF8=1 python -m pipeline.buildings          # all cities, one height model for all
```

It writes `web/public/data/buildings/<id>.fgb` (FlatGeobuf with a spatial index; properties `h` height in m
to 0.5, `conf` 0–1, `src` 0 = OSM tag, 1 = model) and `model.json` with the held-out errors. The files are
tens of MB and are not committed: build and deploy copy them from `web/public/data/` like the JSON.

Footprints are OSM `building=*` inside the city outline + 1.5 km, plus Microsoft footprints that share at most
10 % of their area with an OSM building; under 6 m² dropped, simplified at 0.4 m. Height is the OSM `height` or
`building:levels` × 3 m where tagged; elsewhere a gradient-boosting model (the method of the Soya project) on
footprint shape (area, perimeter, compactness, oriented-rectangle sides, elongation, vertices), the type prior,
distance to the centre, GHSL Built-H at the building, neighbour count and size within 100 m, neighbour heights
within 150 m and the city. One model for the three cities; the error is measured on 20 % of the tagged buildings
of each city held out, with neighbour heights taken from the training part only. Confidence of a modelled
height is 1 − (10–90 % quantile interval) / 24 m, kept within 0.12–0.85.

| City | Buildings | Tagged | Added from MS | Held out | MAE model | MAE type prior | MAE GHSL |
|---|---|---|---|---|---|---|---|
| Tashkent | 496 687 | 26 244 | 179 479 | 5 249 | 3.89 m | 6.34 m | 6.81 m |
| Samarkand | 147 832 | 2 469 | 57 574 | 494 | 1.42 m | 4.72 m | 7.42 m |
| Bukhara | 13 623 | 1 448 | 0 | 290 | 2.42 m | 4.10 m | 4.41 m |

Microsoft's footprints have no coverage around Bukhara (568 in its whole quadkey), so Bukhara stays OSM only.

A full run also writes `model-<id>.json`: the final booster as a compact JSON the web app evaluates in
the browser for "что если" (`uzha/browser_model.py`). When the raw downloads are no longer cached, refit it
from the cell table already in `<id>.json` (same params and seed). The JSON values are rounded, so the refit differs
a little from the full run's model; the step therefore also rewrites the SHAP columns, `baseValue`, `globalImportance`
and the district means in `<id>.json` from the refit, so the map's attributions and "what if" come from one booster.
The log prints how far the refit moved each cell's prediction:

```bash
PYTHONUTF8=1 python -m pipeline.run --all --only model
```

Data handed to us (stations, sensors, another temperature raster) is compared with the published map without any
downloads, in seconds:

```bash
PYTHONUTF8=1 python -m pipeline.compare --city tashkent --points stations.csv [--value t_max]
PYTHONUTF8=1 python -m pipeline.compare --city tashkent --raster their_lst.tif [--scale 0.00341802 --offset 149]
```

`uzha/external.py` reads the CSV (lon/lat by name, `,` or `;`, decimal commas), puts points in their 200 m cell,
averages a finer raster into cells or our cells into a coarser raster's pixels, detects Kelvin, and reports n, r,
Spearman ρ, bias, RMSE and the overlap of the hottest 10 %.

`PYTHONUTF8=1` only matters on Windows: without it the console's code page garbles Cyrillic in log output.

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
   holds whole blocks out. Cells at a block's edge still have training neighbours across it; `python -m pipeline.cv_check --all`
   measures that: with a 400 m buffer R² drops by 0.01–0.04, with 4 km blocks by 0.02, and a linear model scores 0.09–0.22 lower
   (`uzha/cv.py`, results in the main README).
5. **Explanation.** The final model is fit on all cells; per-cell SHAP values come from
   `booster.predict(..., pred_contribs=True)` (TreeSHAP, exact for trees). The bias column is
   `baseValue`; the pipeline asserts `sum(shap) + baseValue == prediction`. `globalImportance`
   is mean |SHAP| per factor, plus the Pearson correlation of the raw factor with LST.
6. **Model for the browser.** The same booster is written to `model-<id>.json`: per tree, parallel
   arrays of split feature, threshold or leaf value (float32, shortest round-trip decimal), left child
   (right = left + 1) and the missing-value direction, plus `baseScore`. `check` carries 12 cells with
   the booster's own predictions; the pytest and the web tests both reproduce them to 1e-5 (both add the trees up in float32, as XGBoost does).

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

## Physics model inputs

`uzha/seb/inputs.py` turns a city into the solver's `SebInputs` and `Forcing` (`uzha/seb/types.py`,
equations in `docs/theory.pdf`). It reads the exported `<id>.json` and adds four small downloads, cached in
`pipeline/cache/seb/<id>_<grid-hash>/`; a summary of every input goes to `pipeline/cache/seb/<id>_summary.json`:

```bash
PYTHONUTF8=1 python -m pipeline.uzha.seb.inputs --city tashkent
```

| Input | How | Source / assumption |
|---|---|---|
| tree, bare | WorldCover shares from the JSON | ESA WorldCover 2021 |
| water | WorldCover class 80 share, 20 m nearest sample; fallback 1 − √(d̄/100 m) from `water_dist` (water as a strip on one side of the cell) | ESA WorldCover 2021 |
| roof | `volume / (height · 10 000)` = the GHSL Built-S building share, cut to `built` | GHSL Built-S 2020 |
| road | OSM drivable ways, length per cell × carriageway width: `width` tag, else `lanes` × 3.5 m, else by class (motorway 22, trunk 18, primary 14, secondary 11, tertiary 8, unclassified/residential/link 6, living street 5, service 4 m); cut to `built − roof`. Fallback: JSON road density × 7 m | lane width 3.5 m (AASHTO); class widths are an assumption |
| paved | `built − roof − road` (≥ 0) | |
| grass | `1 − tree − built − bare − water` (WorldCover grass, crops, shrubs, wetland) | |
| albedo | tree 0.16, grass 0.21, bare 0.25, water 0.08; roof = road = paved = one value per cell inverted so the area-weighted albedo equals the Sentinel-2 cell albedo, clipped to 0.08–0.45 (0.18 where impervious < 5 %) | Oke (1987) *Boundary Layer Climates*, Tables 1.1 and 8.2 |
| emissivity | tree 0.98, grass 0.95, bare 0.93, roof 0.91, road 0.95, paved 0.90, water 0.96 | Oke (1987), same tables |
| OHM a1, a2 (h), a3 (W/m²) | tree 0.11/0.11/−12.3 (mixed forest); grass 0.32/0.54/−27.4; bare 0.35/0.43/−36.5 (dry soil); water 0.50/0.21/−39.1; roof = mean of Vancouver, Uppsala, Kyoto roofs 0.48/0.34/−33.9; road = mean of three asphalt sets 0.61/0.41/−27.7; paved = mean of two concrete sets 0.83/0.40/−54.2 | Grimmond & Oke (1999), [doi:10.1175/1520-0450(1999)038<0922:HSIUAL>2.0.CO;2](https://doi.org/10.1175/1520-0450(1999)038%3C0922:HSIUAL%3E2.0.CO;2), Table 4 |
| canyon H/W | urban patch = roof + road + paved, λp = roof / patch; square buildings of side L = √(roof · 10 000 / OSM buildings per ha) (city median where OSM has none, 6–60 m); street W = L·(1/√λp − 1); H/W ≤ 6 | regular-array assumption |
| sky view | SVF = cos(atan(2·H/W)), canyon-floor midpoint (cosine-weighted, not the solid-angle form of Eq. 20); 1 in open land | Oke (1981) [doi:10.1002/joc.3370010304](https://doi.org/10.1002/joc.3370010304), Oke (1987) |
| shade | road, paved, grass, bare: share of the canyon floor in building shadow at the overpass zenith, averaged over street orientations; trees and their shadows not included | Masson (2000) [doi:10.1023/A:1002463829265](https://doi.org/10.1023/A:1002463829265) |
| z0m, zd | Macdonald on the patch: zd/H = 1 + 4.43^(−λp)(λp − 1), z0/H = (1 − zd/H)·exp(−[0.5·1.0·(1.2/0.4²)(1 − zd/H)λf]^(−½)), λf = λp·H/L, z0 ≥ 0.01 m; trees 10 m tall: z0 = 1.0, zd = 6.7 m; grass 0.03, bare 0.005, water 0.0002 m; blended by area (zd linear, ln z0); zd + z0 ≤ 0.8·z_ref | Macdonald et al. (1998) [doi:10.1016/S1352-2310(97)00403-2](https://doi.org/10.1016/S1352-2310(97)00403-2); Garratt (1992); Wieringa (1993) [doi:10.1007/BF00705357](https://doi.org/10.1007/BF00705357); Taylor (1987) [doi:10.1007/BF00121863](https://doi.org/10.1007/BF00121863) |
| soil moisture | ERA5-Land `soil_moisture_0_to_7cm` at the overpasses, one city value. With surface moisture on (below): θ = 0.03 + W·(0.439 − 0.03) per cell from the Sentinel-2 OPTRAM wetness W, ERA5-Land where W is missing | Open-Meteo archive, `models=era5_land`; Sadeghi et al. (2017) |
| irrigated | every cell inside the outline (city greenery is watered); ring cells with NDVI > 0.45 (watered crops; rain-fed land is brown by July). With surface moisture on: a cell with W is irrigated when θ(W) ≥ field capacity 0.347 | assumption |
| rural | cell centre outside `boundaries/<id>.geojson` | |
| QF | AH4GUC July and August at 06 UTC, mean; each cell takes its 30″ (~1 km) pixel, spread over the pixel's cells in proportion to building volume so the pixel mean is kept. **Estimated** | Varquez et al. (2021) [doi:10.1038/s41597-021-00850-w](https://doi.org/10.1038/s41597-021-00850-w), CC BY 4.0, OPeNDAP at urbanclimate.tse.ens.isct.ac.jp |
| K↓, diffuse fraction | ERA5 `shortwave_radiation_instant`, `diffuse_radiation_instant`, interpolated to each Landsat acquisition time, averaged | Open-Meteo archive, `models=era5`, UTC |
| L↓ | clear-sky Brutsaert (1975) per cell from the cell's t_air and e_air (as `energy.py`; no keyless L↓ series) | |
| t_air | ERA5 2 m temperature (Open-Meteo corrects it to its DEM height at the city centre), lapse-corrected per cell: T = T_ref − 6.5 K/km·(z − z_ref) (Eq. 47); used as the air temperature at z_ref | ICAO standard lapse rate |
| e_air | from the 2 m dew point (Magnus, Alduchov & Eskridge 1996), one city value | |
| pressure | ERA5 surface pressure, hypsometric per cell elevation, kPa | |
| wind | 10 m wind to z_ref = 60 m by the neutral log law over z0 = 0.1 m (×1.39) | Wieringa (1993) |
| zenith | Eq. 17 at the city centre for the mean day and UTC time of the acquisitions; declination and equation of time from Spencer (1971) via Iqbal (1983) | |
| dK↓/dt | K↓ · d(cos θz)/dt / cos θz, transmissivity held fixed, W m⁻² h⁻¹ | |

## Physics model on the site

```bash
PYTHONUTF8=1 python -m pipeline.seb_check --city tashkent   # or --all
```

`seb_check.py` builds the inputs above, then: scores physics alone and physics plus an XGBoost correction on the
11 published factors out of fold (2 km blocks, 5 folds, `calibrate.cross_validate_hybrid`); fits the final parameters
on all cells and solves; splits the city-minus-ring contrast by factor group with exact Shapley values (all 2⁸
coalitions) on a stratified sample of 1 500 cells inside and 1 500 in the ring (even across LST quintiles, each cell
weighted by the cells it stands for; the efficiency identity is checked per cell); runs the six scenarios on every
eligible cell inside the outline, with a 5–95 % range over 10 parameter sets refitted on block-bootstrap resamples.
It writes `web/public/data/physics.json` ([contract](../docs/data-contract.md)). The slow steps are cached in
`pipeline/cache/seb/<id>_check/`, keyed by a hash of the inputs; a first run of Tashkent takes about 16 minutes
(cross-validation 3, Shapley 3, scenarios 10), a rerun seconds.

Then, for the place panel's "Surfaces (physics)" block:

```bash
PYTHONUTF8=1 python -m pipeline.seb_export --city tashkent   # or --all: every city in physics.json
```

`seb_export.py` writes `web/public/data/seb-<id>.json`: the same inputs per cell as fixed-point columns, the weather and
the parameters `seb_check` fitted, plus check cells with the Python solver's temperature, which the browser's solver
must reproduce. Tashkent: 1.1 MB (0.34 MB gzipped); the rounding moves no converged cell by more than 0.035 K.

Scenario settings: roof albedo 0.55; road albedo 0.30; 10 % canopy from paving and bare ground; 50 % of roofs greened
and watered; 50 % of paving to grass pavers; human-made heat −30 %.

Tashkent (20 446 cells, 15 780 inside):

| | R² | MAE | inside R² |
|---|---|---|---|
| XGBoost (main model) | 0.79 | 1.27 °C | |
| physics alone | 0.42 | 2.15 °C | 0.45 |
| physics + correction | 0.71 | 1.49 °C | 0.72 |

Budget, inside minus ring, °C: observed +1.32 = sealing +2.01, geometry −1.06, transpiration −0.73, anthropogenic
+0.34, shade −0.10, albedo +0.04, water −0.01, storage 0.00, Other +0.83 (model gap +0.91, reference state −0.08).
Several parameters sit at their bounds (minimum stomatal resistances at the floor, air offset +4.6 K), so the fit
leans on the air offset to reach the LST level: read the scenario ranges as parameter spread only, not the whole
uncertainty.

### Bare soil and surface moisture

Bare soil evaporates through the Sellers et al. (1992) resistance r_ss = exp(8.206 − 4.255·θ/θ_sat), which lets dry
loess evaporate a few hundred W/m² at the overpass. The moisture-availability form of Lee & Pielke (1992),
LE = β·(ρcp/γ)·(e_s(T_s) − e_a)/ra with β = ¼·[1 − cos(π·θ/θ_fc)]², is in the code (`physics.BARE_SOIL_SCHEME = "beta"`)
and scores a little better out of fold on Tashkent (physics R² 0.433 against 0.419); it stays off until the browser
solver and the published files move with it.

Per-cell surface moisture from Sentinel-2 is in the code but **off** (`inputs.USE_SURFACE_MOISTURE = False`,
`inputs.build(..., moisture=True)` to try it). `sources/sentinel.summer_moisture` reads B04, B08, B8A, B11, B12 and
SCL of the same summer scenes as NDVI, at 28.6 m, over soil and vegetation pixels only (WorldCover built-up and water
masked, SCL 4/5/7), and keeps per cell the median NDMI = (B8A − B11)/(B8A + B11) and the median OPTRAM wetness
W = (STR − STR_d)/(STR_w − STR_d), STR = (1 − R_B12)²/(2·R_B12), with dry/wet edges fitted on the city's pixels in
the STR–NDVI space as rOPTRAM does (Sadeghi et al. 2017, [doi:10.1016/j.rse.2017.05.041](https://doi.org/10.1016/j.rse.2017.05.041)).
It is cached as `pipeline/cache/seb/<id>_<grid>/sentinel2_moisture.pkl` (~15 min to fetch, ~170 MB peak). W maps
to θ = 0.03 + W·(0.439 − 0.03); cells without W keep ERA5-Land; options: drive the vegetation too
(`MOISTURE_DRIVES_VEGETATION`, irrigated ⇔ θ(W) ≥ field capacity), shift to the ERA5-Land mean
(`MOISTURE_ANCHOR_ERA5`), or use NDMI normalised the same way (`MOISTURE_INDEX = "ndmi"`). No LST goes into W.

Out-of-fold scores on Tashkent (5 folds of 2 km blocks, 20 446 cells; hybrid = physics + XGBoost correction on the
11 JSON factors):

| Variant | physics R² all / inside | physics MAE, K | hybrid R² all / inside |
|---|---|---|---|
| Sellers r_ss, ERA5-Land θ (before) | 0.419 / 0.445 | 2.15 | 0.711 / 0.725 |
| Lee–Pielke β, ERA5-Land θ (**default**) | 0.433 / 0.458 | 2.13 | 0.719 / 0.733 |
| β + separate fitted kB⁻¹ for bare soil | 0.436 / 0.458 | 2.13 | 0.721 / 0.735 |
| Sellers, OPTRAM θ for soil and vegetation | −0.276 / −0.203 | 3.05 | 0.346 / 0.395 |
| β, OPTRAM θ for soil and vegetation | −0.725 / −0.510 | 3.44 | 0.158 / 0.229 |
| β, OPTRAM θ, vegetation keeps the outline rule | −0.015 / 0.235 | 2.71 | 0.538 / 0.633 |
| β, NDMI θ, vegetation keeps the outline rule | −0.436 / −0.144 | 3.16 | 0.495 / 0.609 |

The SWIR moisture makes the model worse in every form tried. Two reasons are visible in the data: the calibration
already puts every minimum stomatal resistance at its lower bound, so the vegetation is short of evaporation even
unstressed and any stress from W warms the green cells further (+3 to +5 K in the NDVI 0.35–0.6 bins); and at low
NDVI dark urban material that WorldCover does not call built-up sits on OPTRAM's wet edge, so bare cells read wet
and come out too cool. Within an NDVI bin W does go the right way (it correlates with LST −0.31 at NDVI 0.45–0.6
and −0.56 above 0.6), so it may help once vegetation can evaporate more and the urban pixels are masked better.

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
uzha/browser_model.py  the booster as compact JSON for the browser (model-<id>.json), reference evaluator
uzha/population.py  light step: people per cell and facilities into an existing city JSON
uzha/weather.py     light step: summer weather (ERA5) into an existing city JSON and cities.json
uzha/energy.py      light step: surface energy balance per cell from LST, albedo, NDVI and the overpass weather
uzha/seb/           physics model: types, inputs (SebInputs, Forcing from a city JSON + small downloads)
uzha/export.py      contract JSON (3-decimal values, 5-decimal coordinates)
buildings.py        CLI: footprints with heights → buildings/<id>.fgb
uzha/footprints.py  OSM + MS merge, simplify, FlatGeobuf export
uzha/heights.py     building height model (shape, neighbours, GHSL), held-out errors, confidence
tests/              pytest
```
