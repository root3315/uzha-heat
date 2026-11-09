// Renders the link preview, public/og.jpg (1200 × 630), from og.html and the city's real data,
// and the home-screen icon, public/apple-touch-icon.png (180 × 180), from favicon.svg.
// Usage: npm run og [-- <cityId>]. Needs a local Chrome; set CHROME_PATH if it is not in the usual place.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contours } from 'd3-contour';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '../..');
const cityId = process.argv[2] ?? 'tashkent';
const out = resolve(web, 'public/og.jpg');
const touchIcon = resolve(web, 'public/apple-touch-icon.png');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

/** The site's temperature steps: colour and how strongly each is laid down, from tokens.css. */
const CLASSES = [
  ['#36697a', 0.72],
  ['#9cbcc0', 0.68],
  ['#d9ddd7', 0.6],
  ['#f1c27f', 0.8],
  ['#e8892b', 0.85],
  ['#b8461d', 0.96],
  ['#5a1a10', 1],
];
const STEP = 2;
const BLUR_PASSES = 3;
const NEUTRAL = 2;
const FRAME = { width: 572, height: 574, pad: 26 };

const readJson = (path) => JSON.parse(readFileSync(resolve(web, path), 'utf8'));

function ringsOf(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function boundary(raw) {
  if (raw.type === 'FeatureCollection') return boundary(raw.features[0]);
  if (raw.type === 'Feature') return raw.geometry;
  return raw;
}

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inPolygons = (point, polygons) => polygons.some(([outer, ...holes]) => inRing(point, outer) && !holes.some((h) => inRing(point, h)));

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One pass of a 3 × 3 weighted blur over the cells that have data; gaps stay gaps. */
function blur(values, nx, ny) {
  const out = new Float64Array(values.length).fill(Number.NaN);
  for (let v = 0; v < ny; v++) {
    for (let u = 0; u < nx; u++) {
      if (Number.isNaN(values[v * nx + u])) continue;
      let sum = 0;
      let weight = 0;
      for (let dv = -1; dv <= 1; dv++) {
        for (let du = -1; du <= 1; du++) {
          if (u + du < 0 || u + du >= nx || v + dv < 0 || v + dv >= ny) continue;
          const t = values[(v + dv) * nx + (u + du)];
          if (Number.isNaN(t)) continue;
          const w = du === 0 && dv === 0 ? 4 : du === 0 || dv === 0 ? 2 : 1;
          sum += t * w;
          weight += w;
        }
      }
      out[v * nx + u] = sum / weight;
    }
  }
  return out;
}

const formatSigned = (v, digits = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits).replace('.', ',')}°`;

function build() {
  const detail = readJson(`public/data/${cityId}.json`);
  const polygons = ringsOf(boundary(readJson(`public/boundaries/${cityId}.geojson`)));
  const { lon, lat, lst } = detail.cells;
  const [hx, hy] = detail.grid.halfSizeDeg;

  // The same heat island as the app: median inside the outline minus median of the ring around it.
  const inside = lon.map((x, i) => inPolygons([x, lat[i]], polygons));
  const island = median(lst.filter((_, i) => inside[i])) - median(lst.filter((_, i) => !inside[i]));

  // Cells onto a raster, one pixel per 200 m, then blurred a few times, as the app smooths its surface.
  const x0 = Math.min(...lon);
  const y1 = Math.max(...lat);
  const nx = Math.round((Math.max(...lon) - x0) / (2 * hx)) + 1;
  const ny = Math.round((y1 - Math.min(...lat)) / (2 * hy)) + 1;
  const raw = new Float64Array(nx * ny).fill(Number.NaN);
  lst.forEach((t, i) => {
    raw[Math.round((y1 - lat[i]) / (2 * hy)) * nx + Math.round((lon[i] - x0) / (2 * hx))] = t;
  });
  const NO_DATA = -1000;
  let field = raw;
  for (let pass = 0; pass < BLUR_PASSES; pass++) field = blur(field, nx, ny);
  const grid = field.map((t) => (Number.isNaN(t) ? NO_DATA : t));

  const mean = detail.stats.lstMean;
  const floor = Math.floor(mean / STEP) * STEP;
  const thresholds = Array.from({ length: CLASSES.length - 1 }, (_, k) => floor + (k + 1 - NEUTRAL) * STEP);

  // Raster pixels and lon/lat onto the frame, east-west scaled by the latitude so the city keeps its shape.
  const kx = Math.cos((((y1 + Math.min(...lat)) / 2) * Math.PI) / 180);
  const w = nx * kx;
  const scale = Math.min((FRAME.width - FRAME.pad * 2) / w, (FRAME.height - FRAME.pad * 2) / ny);
  const ox = (FRAME.width - w * scale) / 2;
  const oy = (FRAME.height - ny * scale) / 2;
  const px = (u, v) => [ox + u * kx * scale, oy + v * scale];
  const fromLonLat = ([x, y]) => px((x - x0) / (2 * hx) + 0.5, (y1 - y) / (2 * hy) + 0.5);
  const path = (rings) => rings.map((ring) => `M${ring.map((p) => p.map((c) => c.toFixed(1)).join(',')).join('L')}Z`).join('');

  const generator = contours().size([nx, ny]).smooth(true);
  const bands = [NO_DATA + 1, ...thresholds].map((t, k) => {
    const shape = generator.contour(grid, t);
    const d = shape.coordinates.map((polygon) => path(polygon.map((ring) => ring.map(([u, v]) => px(u, v))))).join('');
    const [color, opacity] = CLASSES[k];
    return `<path d="${d}" fill="${color}" fill-opacity="${opacity}" />`;
  });
  const lines = thresholds.map((t) => {
    const shape = generator.contour(grid, t);
    const d = shape.coordinates.map((polygon) => path(polygon.map((ring) => ring.map(([u, v]) => px(u, v))))).join('');
    return `<path d="${d}" fill="none" stroke="#121417" stroke-opacity="0.3" stroke-width="0.7" />`;
  });
  const outline = polygons.map((polygon) => path(polygon.map((ring) => ring.map(fromLonLat)))).join('');
  const svg =
    `<defs><clipPath id="city"><path d="${outline}" clip-rule="evenodd" /></clipPath></defs>` +
    `<g clip-path="url(#city)">${bands.join('')}${lines.join('')}</g>` +
    `<path d="${outline}" fill="none" stroke="#121417" stroke-opacity="0.7" stroke-width="1.4" />`;

  return {
    svg,
    viewBox: `0 0 ${FRAME.width} ${FRAME.height}`,
    fill: {
      city: detail.city.name,
      island: formatSigned(island),
      period: `Landsat ${detail.period.label.replace(/^.*?(\d{4}.\d{4})$/, '$1')}`,
      lo: `${thresholds[0]}°`,
      hi: `${thresholds[thresholds.length - 1]}°`,
    },
  };
}

const chrome = CHROME_CANDIDATES.find((path) => path && existsSync(path));
if (!chrome) throw new Error('Chrome not found: set CHROME_PATH');

const data = build();
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(here, 'og.html')).href, { waitUntil: 'load' });
  await page.evaluate(({ svg, viewBox, fill }) => {
    const map = document.getElementById('map');
    map.setAttribute('viewBox', viewBox);
    map.innerHTML = svg;
    for (const slot of document.querySelectorAll('[data-fill]')) slot.textContent = fill[slot.dataset.fill] ?? slot.textContent;
  }, data);
  await page.evaluate(() => document.fonts.ready);
  // The headline takes the largest size at which its longest word still fits the column.
  await page.evaluate(() => {
    const title = document.querySelector('h1');
    const column = title.clientWidth;
    let size = 112;
    title.style.fontSize = `${size}px`;
    while (size > 60 && title.scrollWidth > column) title.style.fontSize = `${--size}px`;
  });
  await page.screenshot({ path: out, type: 'jpeg', quality: 88 });

  await page.setViewport({ width: 180, height: 180, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(web, 'public/favicon.svg')).href, { waitUntil: 'load' });
  await page.screenshot({ path: touchIcon, type: 'png' });
} finally {
  await browser.close();
}
console.log(`${out}: ${Math.round(statSync(out).size / 1024)} KB, heat island ${data.fill.island}`);
