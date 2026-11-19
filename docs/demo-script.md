# UzHa: 7-minute live demo script

Stage 1: live technical demo and code review, 7 minutes. Interface in English (RU switch in the top bar).
Primary demo: the local site (`npm run dev`). The live site https://uzha.mydevbox.xyz is the extra: jurors open it on
their phones from the QR code.

## Before you start (5 minutes before)

- Terminal: `cd web && npm run dev` → http://localhost:5173. Check that `web/public/data/buildings/*.fgb` are there
  (3D needs them; see README, "Run it").
- Open three tabs, all loaded and warmed up:
  1. `http://localhost:5173/map/tashkent` (map)
  2. `http://localhost:5173/method/tashkent` (method and validation)
  3. `http://localhost:5173/map/samarkand` (the one other city)
- In tab 1, wait until "Where to plant first" (open at the top of the panel) shows its list and the marks 1–5 are on the map.
- Editor, three files open in this order:
  `pipeline/uzha/browser_model.py`, `web/src/domain/whatIf.ts`, `pipeline/tests/test_browser_model.py`.
- Browser zoom 100 %, window wide enough that the map and the panel are side by side.

## Timeline

### 0:00–1:00 · The answer: where to plant first (tab 1)

Say: "UzHa answers one question for Tashkent: where to plant first. Here is the answer."

1. At the top of the panel: **Where to plant first**, already open; the five places are on the map as blue numbers 1–5. Point at the list: **−4.7, −3.0, −2.6, −2.6, −2.5 °C**, for about
   **800–1,400** residents each.
   Say: "Every inhabited 200 metre cell gets the same greening: tree crowns plus grass and watering, that is plus 20 points
   of crown and plus 0.1 NDVI. New crowns take the place of bare ground, then of built-up, so a cell never passes 100 per cent.
   The city's own model gives the cooling. We rank by degrees times residents, at least 1 km apart, not by how hot the cell is today."
2. Click place **1**, in the list or on the map. The panel opens **Bektemir district**, **45.5 °C**, and a ring marks it on the map.

### 1:00–2:15 · What if, in this place

1. Open **What if**.
2. Drag **Trees** from 0 % to **20 %** only. Point at the result: about **−1.3 °C**.
   Say: "A block that is 93 per cent built-up. Crowns alone give about a degree."
3. Drag **Greenery, NDVI** from 0.24 to **0.34**. Result **−4.7 °C**, "about 40.8 °C instead of 45.5 °C".
   Say: "The model links the cooler surface with greening as a whole: crowns plus grass and watering. NDVI alone gives about −3.7.
   This is the city's XGBoost model, running in the browser. Sliders stop at what the city already has, 5th to 95th percentile.
   It is an association in the data, not an experiment."
4. Point at the measure card below: "Each measure links to a published study."

### 2:15–3:30 · Why it is hot here (still tab 1)

1. Click **Whole city**. Point at **43.6 °C** and the sentence under it: "Inside Tashkent the surface is 1.8 degrees hotter than
   the ring around it. The hottest 10% of the map is above 48.1 °C; 313,000 people live on those cells inside the city."
2. Point at the first cause, **Lack of greenery, +3.2 °C**. Say: "This is SHAP: the model splits each cell's temperature into
   factors, in degrees."
3. Point at the section (it already passes through the hottest point): the profile and the hatched band of causes under it.
   Say: "10 of 14 km hotter than average, by up to 9.4 degrees; the model puts most of it on low greenery."
4. Click **People**: residents as dots, schools and clinics on the hottest cells. "Colour still means temperature."

### 3:30–4:00 · 3D

Click **3D**, zoom in on a dense block. Say: "About 660,000 buildings in three cities, each coloured by the surface temperature
under it. Heights from OpenStreetMap, or our own height model where OSM has none." Click **3D** again.

### 4:00–4:30 · It transfers (tab 3)

Switch to the pre-warmed **Samarkand** tab. Point at the summary: "Plus 1.4 °C. Same pipeline, same code.
The hot places differ: here they are open bare land, not housing." Bukhara (+3.1) only if asked.

### 4:30–5:30 · How we checked (tab 2)

Point at, in order:
- **R² 0.79** on spatial block cross-validation: "Whole 2 by 2 km blocks are held out. Mean error about 1.3 degrees."
- **Check against MODIS, and the night**: two NASA satellites, 1 km, same summers.
  Terra, ~10:30: **r = 0.87**. Aqua, ~13:30: **r = 0.85**.
  Say: "r is the main check: is the heat in the same places. The absolute level differs by satellite: our surface is
  4.4 degrees warmer than Terra and 0.4 warmer than Aqua. That is a known difference between products: emissivity,
  30 m against 1 km, view angle, time of day."
- Heat island by MODIS (Aqua), ring 1.5 km, on the page: by day **+2.3 °C**, at night (~01:30) **+2.4 °C**.
  "MODIS at 1 km sees the same island, day and night; Terra gives plus 2.0 by day. Our +1.8 is not a Landsat artefact."
- Rings 0.5 / 1 / 1.5 km: **+1.3 / +1.5 / +1.8 °C**. "The sign does not depend on the ring."

### 5:30–6:40 · Code review: the model in the browser

Say: "Our strongest own piece: the same model in Python and in the browser."
1. `pipeline/uzha/browser_model.py`: `slim()` turns the XGBoost booster into compact JSON per city (split feature,
   threshold, children, leaf values); `document()` stores check rows with the booster's own predictions.
2. `web/src/domain/whatIf.ts`: `walk()` and `predictRow()`. "The evaluator. XGBoost compares in float32, so we do too:
   `Math.fround` on both sides of every split." Then `whatIf()`: the change is clamped to the city's 5–95 % range.
3. `pipeline/tests/test_browser_model.py`: `test_slim_model_reproduces_booster_predictions`, `atol=1e-5`.
   "Python and the browser match the booster to 0.00001 degrees: we compare and add up in float32, like XGBoost. The web tests check the same rows."
   Tests: 115 pipeline (under a minute) and 329 web (`cd web && npm test`, about 15 seconds). Run `npm test` if there is time.

### 6:40–7:00 · Limits and close

Say:
"Limits. This is surface temperature, not air, at about 11 in the morning. What-ifs are associations in the model,
not cause and effect; the next step is a pilot with before-and-after measurement.
Thank you. The site is open on your phones now."

## Numbers to have ready (Tashkent / Samarkand / Bukhara)

| What | Value |
|---|---|
| Heat island, ring 1.5 km | +1.8 / +1.4 / +3.1 °C |
| Heat island, rings 0.5 / 1 / 1.5 km, Tashkent | +1.3 / +1.5 / +1.8 °C |
| R² on held-out 2 × 2 km blocks | 0.79 / 0.77 / 0.69 |
| Mean error on held-out blocks | 1.3 / 1.1 / 1.4 °C |
| MODIS Terra (~10:30): r; mean difference; RMSE | 0.87 / 0.65 / 0.87; +4.4 / +3.2 / +3.3 °C; 4.7 / 3.8 / 3.7 °C |
| MODIS Aqua (~13:30): r; mean difference; RMSE | 0.85 / 0.61 / 0.81; +0.4 / −0.6 / −0.7 °C; 1.7 / 2.1 / 1.8 °C |
| Day heat island, MODIS, ring 1.5 km: Terra; Aqua | +2.0 / +1.6 / +2.1 °C; +2.3 / +2.0 / +2.5 °C |
| Night heat island, Aqua ~01:30, ring 1.5 km | +2.4 / +1.2 / +1.8 °C |
| Mean surface: city + 1.5 km ring (site summary); inside the outline | 43.6 / 42.7 / 41.4 °C; 43.9 / 43.4 / 42.7 °C |
| People inside the city on the map's hottest 10% (above 48.1 / 47.0 / 45.6 °C) | 313,000 / ~7,000 / 55,000; city's own hottest 10%: 260,000 / 5,000 / 27,000 |
| Share of SHAP inside the outline: vegetation and soil; built-up | 64 / 39 / 50 %; 21 / 37 / 27 % |
| Planting list, Tashkent top five | −4.7, −3.0, −2.6, −2.6, −2.5 °C; about 780, 1,200, 1,330, 1,290, 1,370 people |
| Place 1 (Bektemir district): crowns only / NDVI only / both | −1.3 / −3.7 / −4.7 °C; crowns to the city's top (34 %) alone: −1.3 °C |
| Place 1: surface; cover; NDVI; residents | 45.5 °C (43.9 °C inside the city outline); 93 % built-up, no tree cover; 0.24, the median of inhabited cells; ~780 |
| Tests | 115 pipeline + 329 web |

## Jury Q&A

**The trees slider barely moves the temperature. So trees do not help?**
The measure is greening as a whole: tree crowns plus grass and watering, which shows up in NDVI. Crowns alone give about
1 °C at place 1 (−1.3 °C for +20 points, the same at the city's top). The model shows an association, not an
experiment. The next step is a pilot: green one block and measure before and after.

**Your own source (Mukhamedjanov 2024) says crowns cool most and lawns barely. Your model says NDVI. Which is it?**
Both, for different things. That study measured air at 1.5 m in 30 Tashkent squares, at midday; we map the surface at about
11:00. Watered grass cools the surface by evaporation; crowns cool the air by shade. And ESA WorldCover labels each 10 m pixel
by its main class, so narrow rows of street trees can end up as built-up; their leaves then show up in NDVI.

**Place 3 is about the city average (43.5 °C). Why is it on the list?**
The ranking is cooling × residents, not how hot the cell is today: about 1,330 people live there, so the same planting buys
many degrees for many people. Place 1 is both: a hot, 93 % built-up block. The hottest cells are built-up or open land
with few residents: each of the 20 hottest has fewer than 100.

**More trees on a built-up block: where do they go?**
New crowns take the place of bare ground first, then of built-up, so a cell's shares never pass 100 %. Crowns over streets
and yards count as tree cover in WorldCover; the model never sees a cell that could not exist.

**NDVI dominates. That is known. What is new?**
NDVI dominates, as expected. What is new is where, by how many degrees per cell, for how many people, and a what-if anyone
can run. The list is ranked by people × cooling, which is why a low-NDVI, dense-living cell comes first.

**Why compare with Aqua, when Terra passes closer to Landsat's time?**
We show both. The pattern matches for both: r = 0.87 with Terra, 0.85 with Aqua in Tashkent. The absolute offset is a known
difference between products (emissivity, 30 m against 1 km, view angle, time of day); Terra reads 4.4 °C cooler than our
Landsat surface, Aqua 0.4 °C. MOD11A2 is an 8-day clear-sky mean at 1 km with wide view angles, Landsat a 30 m median of single
clear scenes. We never quote the absolute level as truth, only
where it is hot (r) and the city-vs-ring sign. Both hold with either satellite.

**What did you write yourselves?**
The 200 m grid and the assembly of all factors onto it; spatial block cross-validation; SHAP grouping of correlated factors;
the export of XGBoost to JSON and the in-browser evaluator, tested to 0.00001 °C; the planting ranking; the building-height
model for 3D. Then each member names their part:
- Amira: ROLE
- Oliya: ROLE
- Maksim: ROLE
- Shakhina: ROLE
- Stepan: ROLE

**Can you check it against our data?**
Yes, now: `python -m pipeline.compare --city tashkent --points <your.csv>` or `--raster <your.tif>`. Any CSV with
longitude, latitude and a value, or a GeoTIFF in any projection; it runs in seconds on the published map and prints r,
Spearman, the mean difference and how much of our hottest 10 % is also in yours. For air temperature expect a
difference; r says whether the heat is in the same places.

**Is R² 0.79 not optimistic? Neighbouring cells look alike.**
We hold out whole 2 km blocks. With a 400 m buffer, so no training cell touches a held-out one, it is 0.78 / 0.73 / 0.66;
with 4 km blocks 0.77 / 0.75 / 0.67. Random splits would say 0.82: that is the optimistic one, and we do not use it.
A linear model on the same blocks gets 0.67, NDVI alone 0.65 in Tashkent. `python -m pipeline.cv_check --all`, under a minute.

**Backup: why only +1.8 °C? Tashkent feels much hotter.**
The comparison ring is suburban itself, not a cool forest: 37 % built-up against 55 % inside the city, NDVI 0.34
against 0.29. So the contrast is modest. MODIS at 1 km gives +2.0–2.4 °C by day and +2.4 °C at night for Tashkent, so
+1.8 is not a Landsat artefact; and the sign holds for any ring width: +1.3 / +1.5 / +1.8 °C for 0.5 / 1 / 1.5 km.

**Backup: what is "Energy balance" on the method page?**
A physical estimate next to the statistical model: where the absorbed sunlight goes, in W/m², split into evaporation, heating
the air and the ground, by the S-SEBI / SEBAL energy balance from our map data and ERA5 at the overpass hour.

**Other likely questions**
- *Why surface and not air?* Landsat measures the surface. It is what we can map at 30 m for the whole city; we say so on every screen.
- *Why XGBoost and not a linear model?* Factors interact (greenery matters more where it is built up). Trees capture that, and SHAP keeps the result in degrees.
- *Why 200 m cells?* Close to a city block, larger than Landsat's thermal pixel, and light enough to run in the browser.

## Fallback

1. Local site down: `cd web && npm run dev` again. All city data, models and the planting list are local files in `web/public/data/`.
2. No network: the basemap (streets, labels from OpenFreeMap) does not load. Heat map, isotherms, panel, what-if and planting list still work.
3. 3D without the local `.fgb` files shows only the basemap's buildings; skip the 3D step.
4. Browser fails completely: open `docs/uzha-pitch-en.pptx`, slides 3, 4, 6 show screenshots; 4–8 carry the numbers.
