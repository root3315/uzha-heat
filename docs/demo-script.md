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
- In tab 1, open "Where to plant first" → "calculate for the city" once, so the list is ready.
- Editor, three files open in this order:
  `pipeline/uzha/browser_model.py`, `web/src/domain/whatIf.ts`, `pipeline/tests/test_browser_model.py`.
- Browser zoom 100 %, window wide enough that the map and the panel are side by side.

## Timeline

### 0:00–1:00 · The answer: where to plant first (tab 1)

Say: "UzHa answers one question for Tashkent: where to plant first. Here is the answer."

1. In the panel: **Where to plant first**. Point at the list: **−3.7°, −3.1°, −2.7°, −2.6°, −2.6°**, each for about
   **1,200–1,400** residents.
   Say: "Every inhabited 200 metre cell gets the same greening: tree crowns plus grass and watering, that is plus 20 points
   of crown and plus 0.1 NDVI. The city's own model gives the cooling. We rank by degrees times residents, at least 1 km apart."
2. Click place **1**. The map flies to **Near Small Ring Road**, **43.5°**.

### 1:00–2:15 · What if, in this place

1. Open **What if**.
2. Drag **Trees** from 3 % to **23 %** only. Point at the result: about **−0.5°**.
   Say: "Crowns alone do little here."
3. Drag **Greenery, NDVI** from 0.14 to **0.24**. Result **−3.7°**, "about 39.9° instead of 43.5°".
   Say: "Greening as a whole does it: crowns plus grass and watering. NDVI alone gives about −3.1.
   This is the city's XGBoost model, running in the browser. Sliders stop at what the city already has, 5th to 95th percentile.
   It is an association in the data, not an experiment."
4. Point at the measure card below: "Each measure links to a published study."

### 2:15–3:30 · Why it is hot here (still tab 1)

1. Click **Whole city**. Point at **43.6°** and the sentence under it: "Inside Tashkent the surface is 1.8 degrees hotter than
   the ring around it. One in ten cells is above 48.1."
2. Point at the first cause, **Lack of greenery, +3.2°**. Say: "This is SHAP: the model splits each cell's temperature into
   factors, in degrees."
3. Click **Already through the hottest**. Point at the profile and the hatched band of causes under it.
   Say: "10 of 14 km hotter than average, by up to 9.4 degrees; most of it is lack of greenery."
4. Click **People**: residents as dots, schools and clinics on the hottest cells. "Colour still means temperature."

### 3:30–4:00 · 3D

Click **3D**, zoom in on a dense block. Say: "About 660,000 buildings in three cities, each coloured by the surface temperature
under it. Heights from OpenStreetMap, or our own height model where OSM has none." Click **3D** again.

### 4:00–4:30 · It transfers (tab 3)

Switch to the pre-warmed **Samarkand** tab. Point at the summary: "Plus 1.4 degrees. Same pipeline, same code.
The hot places differ: here they are open bare land, not housing." Bukhara (+3.1) only if asked.

### 4:30–5:30 · How we checked (tab 2)

Point at, in order:
- **R² 0.79** on spatial block cross-validation: "Whole 2 by 2 km blocks are held out. Mean error about 1.3 degrees."
- **Check against MODIS, and the night**: two NASA satellites, 1 km, same summers.
  Terra, ~10:30: **r = 0.87**. Aqua, ~13:30: **r = 0.85**.
  Say: "r is the main check: is the heat in the same places. The absolute level differs by satellite: our surface is
  4.4 degrees warmer than Terra and 0.4 warmer than Aqua. That is a known difference between products: emissivity,
  30 m against 1 km, view angle, time of day."
- Night line, Aqua ~01:30: **+2.4°**. "At night the city is still warmer than its ring. Landsat cannot see that."
- Rings 0.5 / 1 / 1.5 km: **+1.3 / +1.5 / +1.8°**. "The sign does not depend on the ring."

### 5:30–6:40 · Code review: the model in the browser

Say: "Our strongest own piece: the same model in Python and in the browser."
1. `pipeline/uzha/browser_model.py`: `slim()` turns the XGBoost booster into compact JSON per city (split feature,
   threshold, children, leaf values); `document()` stores check rows with the booster's own predictions.
2. `web/src/domain/whatIf.ts`: `walk()` and `predictRow()`. "The evaluator. XGBoost compares in float32, so we do too:
   `Math.fround` on both sides of every split." Then `whatIf()`: the change is clamped to the city's 5–95 % range.
3. `pipeline/tests/test_browser_model.py`: `test_slim_model_reproduces_booster_predictions`, `atol=1e-4`.
   "Python and the browser match the booster to 0.0001 degrees; the web tests check the same rows."
   Tests: 92 pipeline (about a minute) and 309 web (`cd web && npm test`, about 15 seconds). Run `npm test` if there is time.

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
| Night heat island, Aqua ~01:30, ring 1.5 km | +2.4 / +1.2 / +1.8 °C |
| City mean surface temperature | 43.6 / 42.7 / 41.4 °C |
| People in the hottest tenth of cells | 313,000 / ~7,000 / 55,000 |
| Planting list, Tashkent top five | −3.7, −3.1, −2.7, −2.6, −2.6 °C; 1.2–1.4 thousand people each |
| Place 1 (Small Ring Road): crowns only / NDVI only / both | −0.5 / −3.1 / −3.7 °C; crowns to the city's top (34 %) alone: −0.8 °C |
| Tests | 92 pipeline + 309 web |

## Jury Q&A

**The trees slider barely moves the temperature. So trees do not help?**
The measure is greening as a whole: tree crowns plus grass and watering, which shows up in NDVI. Crowns alone give under
1 °C at this place (−0.5 °C for +20 points, −0.8 °C even at the city's top). The model shows an association, not an
experiment. The next step is a pilot: green one block and measure before and after.

**Why compare with Aqua, when Terra passes closer to Landsat's time?**
We show both. The pattern matches for both: r = 0.87 with Terra, 0.85 with Aqua in Tashkent. The absolute offset is a known
difference between products (emissivity, 30 m against 1 km, view angle, time of day); Terra reads 4.4 °C cooler than our
Landsat surface, Aqua 0.4 °C. What we check is where it is hot, and that holds with either satellite.

**What did you write yourselves?**
The 200 m grid and the assembly of all factors onto it; spatial block cross-validation; SHAP grouping of correlated factors;
the export of XGBoost to JSON and the in-browser evaluator, tested to 0.0001 °C; the planting ranking; the building-height
model for 3D. Then each member names their part:
- Amira: ROLE
- Oliya: ROLE
- Maksim: ROLE
- Shakhina: ROLE
- Stepan: ROLE

**Backup: why only +1.8 °C? Tashkent feels much hotter.**
The comparison ring is suburban itself, not a cool forest: 37 % built-up against 55 % inside the city, NDVI 0.34
against 0.29. So the day contrast is modest. At night,
when the city's stored heat shows, MODIS gives +2.4 °C. And the sign does not depend on the ring width: +1.3 / +1.5 / +1.8 °C
for 0.5 / 1 / 1.5 km.

**Backup: what is "Physics of the hottest tenth"?**
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
4. Browser fails completely: open `docs/uzha-pitch-en.pptx`, slides 3–8 carry real screenshots and the same numbers.
