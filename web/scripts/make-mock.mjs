// Synthetic data generator for the web app (see docs/data-contract.md).
// Writes public/data/cities.json and public/data/tashkent.json only if they do not exist yet,
// so real pipeline output is never overwritten.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');

const BBOX = [69.12, 41.2, 69.43, 41.42];
const HALF = [0.0012, 0.0009];
const BASE_VALUE = 44.0;
const M_PER_DEG_LAT = 111_000;
const M_PER_DEG_LON = 111_000 * Math.cos((41.31 * Math.PI) / 180);

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = seededRandom(20250714);

/** Smooth field in [-1, 1]: a sum of random plane waves. */
function smoothField(waves = 7, minScale = 1.5, maxScale = 6) {
  const terms = Array.from({ length: waves }, () => {
    const angle = rand() * Math.PI * 2;
    const freq = minScale + rand() * (maxScale - minScale);
    return { kx: Math.cos(angle) * freq, ky: Math.sin(angle) * freq, phase: rand() * Math.PI * 2 };
  });
  return (x, y) => terms.reduce((sum, t) => sum + Math.sin(t.kx * x + t.ky * y + t.phase), 0) / Math.sqrt(waves * 0.5) / 1.6;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round3 = (v) => Math.round(v * 1000) / 1000;
const gaussian = (lon, lat, cLon, cLat, rLonM, rLatM) => {
  const dx = ((lon - cLon) * M_PER_DEG_LON) / rLonM;
  const dy = ((lat - cLat) * M_PER_DEG_LAT) / rLatM;
  return Math.exp(-(dx * dx + dy * dy));
};

function distanceToSegmentM(lon, lat, [aLon, aLat], [bLon, bLat]) {
  const px = (lon - aLon) * M_PER_DEG_LON;
  const py = (lat - aLat) * M_PER_DEG_LAT;
  const bx = (bLon - aLon) * M_PER_DEG_LON;
  const by = (bLat - aLat) * M_PER_DEG_LAT;
  const t = clamp((px * bx + py * by) / (bx * bx + by * by), 0, 1);
  return Math.hypot(px - t * bx, py - t * by);
}

const distanceToPolylineM = (lon, lat, line) =>
  line.slice(1).reduce((min, point, k) => Math.min(min, distanceToSegmentM(lon, lat, line[k], point)), Infinity);

// Canals and the Chirchiq-side reservoirs, roughly following Ankhor, Bozsu and Salar.
const WATERWAYS = [
  [[69.2, 41.405], [69.235, 41.37], [69.255, 41.335], [69.262, 41.312], [69.24, 41.285], [69.2, 41.255], [69.15, 41.235]],
  [[69.34, 41.42], [69.335, 41.38], [69.322, 41.335], [69.318, 41.29], [69.3, 41.245], [69.29, 41.2]],
  [[69.43, 41.41], [69.41, 41.35], [69.405, 41.29], [69.385, 41.2]],
  [[69.13, 41.4], [69.165, 41.33], [69.15, 41.27], [69.17, 41.2]],
];

const PARKS = [
  { lon: 69.328, lat: 41.345, r: 1300 },
  { lon: 69.246, lat: 41.318, r: 700 },
  { lon: 69.292, lat: 41.29, r: 600 },
];

const INDUSTRIAL = [
  { lon: 69.215, lat: 41.232, rx: 2600, ry: 1700 },
  { lon: 69.282, lat: 41.258, rx: 1800, ry: 900 },
  { lon: 69.395, lat: 41.255, rx: 1500, ry: 1200 },
];

const FEATURES = [
  { key: 'ndvi', label: 'Растительность', unit: 'NDVI', description: 'Индекс растительности, медиана летних снимков Sentinel-2.' },
  { key: 'tree', label: 'Древесный покров', unit: '% площади', description: 'Доля деревьев в ячейке, ESA WorldCover 2021.' },
  { key: 'built', label: 'Застройка', unit: '% площади', description: 'Доля застроенной поверхности, ESA WorldCover 2021.' },
  { key: 'bare', label: 'Открытый грунт', unit: '% площади', description: 'Доля открытого грунта без растительности, ESA WorldCover 2021.' },
  { key: 'albedo', label: 'Отражающая способность', unit: 'albedo 0–1', description: 'Широкополосное альбедо по Sentinel-2 (Liang, 2001).' },
  { key: 'roads', label: 'Плотность дорог', unit: 'км/км²', description: 'Длина дорог OpenStreetMap на единицу площади.' },
  { key: 'buildings', label: 'Плотность зданий', unit: 'шт/га', description: 'Число зданий OpenStreetMap на гектар.' },
  { key: 'water_dist', label: 'Удалённость от воды', unit: 'м', description: 'Расстояние до ближайшего водоёма или канала.' },
  { key: 'elevation', label: 'Высота', unit: 'м', description: 'Высота над уровнем моря, Copernicus DEM GLO-30.' },
];

// Synthetic "true" response of LST to each factor, °C. SHAP = response minus its city mean.
const RESPONSE = {
  ndvi: (v) => -9.5 * Math.sqrt(Math.max(v, 0)),
  tree: (v) => -0.045 * v,
  built: (v) => 0.034 * v,
  bare: (v) => 0.08 * v,
  albedo: (v) => -16 * v,
  roads: (v) => 0.1 * v,
  buildings: (v) => 0.022 * v,
  water_dist: (v) => 0.85 * Math.log1p(v / 150),
  elevation: (v) => -0.011 * v,
};

function buildCells() {
  const noise = Object.fromEntries(
    ['urban', 'built', 'bare', 'tree', 'ndvi', 'albedo', 'roads', 'buildings', 'fields', 'resid', 'elev'].map((k) => [k, smoothField()]),
  );
  const fine = smoothField(9, 14, 30);
  const cells = { lon: [], lat: [], lst: [], values: {}, shap: {} };
  const raw = Object.fromEntries(FEATURES.map((f) => [f.key, []]));
  const [w, s, e, n] = BBOX;

  for (let lat = s + HALF[1]; lat < n; lat += HALF[1] * 2) {
    for (let lon = w + HALF[0]; lon < e; lon += HALF[0] * 2) {
      const x = (lon - w) / (e - w);
      const y = (lat - s) / (n - s);
      const urban = clamp(gaussian(lon, lat, 69.275, 41.31, 10500, 8500) + 0.18 * noise.urban(x, y), 0, 1);
      const park = Math.max(...PARKS.map((p) => gaussian(lon, lat, p.lon, p.lat, p.r, p.r)));
      const industry = Math.max(...INDUSTRIAL.map((z) => gaussian(lon, lat, z.lon, z.lat, z.rx, z.ry)));
      const waterDist = Math.min(...WATERWAYS.map((line) => distanceToPolylineM(lon, lat, line)));
      const bank = Math.exp(-waterDist / 250);
      const fields = (1 - urban) * clamp(0.5 + 0.6 * noise.fields(x, y), 0, 1);

      const built = clamp(100 * (0.1 + 0.78 * urban + 0.12 * noise.built(x, y) + 0.08 * fine(x, y)) - 75 * park - 18 * bank - 40 * fields + 10 * industry, 0, 97);
      const bare = clamp(4 + 55 * industry + 22 * (1 - urban) * Math.max(0, noise.bare(x, y)) + 4 * fine(x, y) - 10 * park - 15 * fields, 0, 90);
      const tree = clamp(6 + 22 * urban * (0.5 + 0.5 * noise.tree(x, y)) + 58 * park + 18 * bank + 5 * fine(x, y) - 20 * industry, 0, 92);
      const ndvi = clamp(0.06 + 0.0055 * tree + 0.42 * fields + 0.04 * noise.ndvi(x, y) - 0.0015 * bare + 0.03 * fine(x, y), 0.02, 0.78);
      const albedo = clamp(0.16 + 0.0012 * bare - 0.03 * urban + 0.035 * noise.albedo(x, y) + 0.015 * fine(x, y), 0.08, 0.32);
      const roads = clamp(1 + 10 * urban + 2.5 * noise.roads(x, y) + 2 * fine(x, y) - 6 * park, 0, 17);
      const buildings = clamp(0.32 * built + 5 * noise.buildings(x, y) - 4 * industry, 0, 48);
      const elevation = 395 + 135 * (0.62 * x + 0.38 * y) + 6 * noise.elev(x, y);

      const values = { ndvi, tree, built, bare, albedo, roads, buildings, water_dist: waterDist, elevation };
      cells.lon.push(lon);
      cells.lat.push(lat);
      for (const f of FEATURES) raw[f.key].push(values[f.key]);
      cells.lst.push(2.4 * noise.resid(x, y) + 1.4 * (rand() - 0.5) * 2);
    }
  }

  const count = cells.lon.length;
  for (const f of FEATURES) {
    const response = raw[f.key].map(RESPONSE[f.key]);
    const mean = response.reduce((a, b) => a + b, 0) / count;
    cells.values[f.key] = raw[f.key];
    cells.shap[f.key] = response.map((r) => r - mean);
  }
  const predicted = Array.from({ length: count }, (_, i) => BASE_VALUE + FEATURES.reduce((sum, f) => sum + cells.shap[f.key][i], 0));
  const residualMean = mean(cells.lst);
  const residual = cells.lst.map((r) => r - residualMean);
  cells.lst = predicted.map((p, i) => p + residual[i]);
  return { cells, predicted };
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function quantile(xs, q) {
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.ceil(pos)] - sorted[lo]) * (pos - lo);
}

function pearson(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

// ---- districts: a jittered 4×3 tiling with wavy shared borders ----
const DISTRICT_NAMES = [
  ['Янгихаётский район', 'Сергелийский район', 'Яккасарайский район', 'Бектемирский район'],
  ['Учтепинский район', 'Чиланзарский район', 'Мирабадский район', 'Яшнабадский район'],
  ['Алмазарский район', 'Шайхантахурский район', 'Юнусабадский район', 'Мирзо-Улугбекский район'],
];

function districtVertices(cols, rows) {
  const [w, s, e, n] = BBOX;
  return Array.from({ length: rows + 1 }, (_, j) =>
    Array.from({ length: cols + 1 }, (_, i) => {
      const interiorX = i > 0 && i < cols;
      const interiorY = j > 0 && j < rows;
      const jx = interiorX ? (rand() - 0.5) * 0.4 : 0;
      const jy = interiorY ? (rand() - 0.5) * 0.4 : 0;
      return [w + ((i + jx) / cols) * (e - w), s + ((j + jy) / rows) * (n - s)];
    }),
  );
}

const wobble = smoothField(5, 20, 45);

/** Points along an edge, identical for both neighbours because they depend only on the sorted endpoints. */
function wavyEdge(a, b, onBoundary) {
  if (onBoundary) return [a, b];
  const forward = a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const [p, q] = forward ? [a, b] : [b, a];
  const steps = 8;
  const nx = -(q[1] - p[1]);
  const ny = q[0] - p[0];
  const len = Math.hypot(nx, ny);
  const pts = Array.from({ length: steps + 1 }, (_, k) => {
    if (k === 0) return p;
    if (k === steps) return q;
    const t = k / steps;
    const x = p[0] + (q[0] - p[0]) * t;
    const y = p[1] + (q[1] - p[1]) * t;
    const amp = 0.004 * wobble((x - BBOX[0]) * 8, (y - BBOX[1]) * 8);
    return [x + (nx / len) * amp, y + (ny / len) * amp];
  });
  return forward ? pts : pts.reverse();
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function buildDistricts(cells) {
  const cols = 4;
  const rows = 3;
  const v = districtVertices(cols, rows);
  const districts = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const corners = [v[j][i], v[j][i + 1], v[j + 1][i + 1], v[j + 1][i]];
      const boundary = [j === 0, i === cols - 1, j === rows - 1, i === 0];
      const ring = [];
      corners.forEach((corner, k) => {
        const edge = wavyEdge(corner, corners[(k + 1) % 4], boundary[k]);
        ring.push(...edge.slice(0, -1));
      });
      ring.push(ring[0]);
      districts.push({ name: DISTRICT_NAMES[j][i], ring });
    }
  }
  return districts.map(({ name, ring }) => {
    const members = cells.lon.map((lon, k) => k).filter((k) => pointInRing(cells.lon[k], cells.lat[k], ring));
    const shapMean = Object.fromEntries(FEATURES.map((f) => [f.key, round3(mean(members.map((k) => cells.shap[f.key][k])))]));
    return {
      name,
      geometry: { type: 'Polygon', coordinates: [ring.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5])] },
      lstMean: round3(mean(members.map((k) => cells.lst[k]))),
      cellCount: members.length,
      shapMean,
    };
  });
}

function buildCity(cells, predicted) {
  const lstMean = mean(cells.lst);
  const residuals = cells.lst.map((t, i) => t - predicted[i]);
  const ssRes = residuals.reduce((a, r) => a + r * r, 0);
  const ssTot = cells.lst.reduce((a, t) => a + (t - lstMean) ** 2, 0);
  const r2 = 1 - ssRes / ssTot;
  const mae = mean(residuals.map(Math.abs));

  const city = {
    id: 'tashkent',
    name: 'Ташкент',
    nameEn: 'Tashkent',
    country: 'Узбекистан',
    center: [69.2797, 41.3111],
    bbox: BBOX,
    photo: { url: 'https://upload.wikimedia.org/wikipedia/commons/8/8a/Tashkent_city.jpg', credit: 'Wikimedia Commons' },
    lstMean: round3(lstMean),
    r2: round3(r2),
  };

  const globalImportance = FEATURES.map((f) => ({
    key: f.key,
    meanAbsShap: round3(mean(cells.shap[f.key].map(Math.abs))),
    correlation: round3(pearson(cells.values[f.key], cells.lst)),
  })).sort((a, b) => b.meanAbsShap - a.meanAbsShap);

  const roundAll = (xs) => xs.map(round3);
  const detail = {
    city,
    period: { label: 'июнь–август 2023–2025 · демо-данные', lstScenes: 9, s2Scenes: 6 },
    grid: { cellSizeM: 200, halfSizeDeg: HALF, count: cells.lon.length },
    features: FEATURES,
    model: { type: 'XGBoost', r2Cv: round3(r2), maeCv: round3(mae), cv: 'spatial block 5-fold', baseValue: BASE_VALUE },
    stats: {
      lstMean: round3(lstMean),
      lstMin: round3(Math.min(...cells.lst)),
      lstMax: round3(Math.max(...cells.lst)),
      lstP10: round3(quantile(cells.lst, 0.1)),
      lstP90: round3(quantile(cells.lst, 0.9)),
    },
    globalImportance,
    cells: {
      lon: cells.lon.map((x) => Math.round(x * 1e5) / 1e5),
      lat: cells.lat.map((x) => Math.round(x * 1e5) / 1e5),
      lst: roundAll(cells.lst),
      values: Object.fromEntries(FEATURES.map((f) => [f.key, roundAll(cells.values[f.key])])),
      shap: Object.fromEntries(FEATURES.map((f) => [f.key, roundAll(cells.shap[f.key])])),
    },
    districts: buildDistricts(cells),
  };
  return { city, detail };
}

function writeIfAbsent(name, payload) {
  const path = join(DATA_DIR, name);
  if (existsSync(path)) {
    console.log(`skip ${name}: already exists (real data is never overwritten)`);
    return;
  }
  writeFileSync(path, JSON.stringify(payload));
  console.log(`wrote ${name}`);
}

mkdirSync(DATA_DIR, { recursive: true });
const { cells, predicted } = buildCells();
const { city, detail } = buildCity(cells, predicted);
writeIfAbsent('cities.json', [city]);
writeIfAbsent(`${city.id}.json`, detail);
console.log(`cells: ${detail.grid.count}, R²: ${city.r2}, LST mean: ${city.lstMean} °C`);
