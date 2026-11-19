import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CityDetail } from '../data/contract';
import { parseNight } from '../data/night';
import { DataContractError, parseCityDetail } from '../data/parse';
import { buildCellGrid } from './grid';
import { CLASS_COUNT } from './isotherms';
import {
  availableLayers,
  colourOf,
  fluxAt,
  fluxContours,
  fluxLevels,
  legendClasses,
  lonLatToSinusoidal,
  nightAt,
  nightLevels,
  nightPixels,
  niceStep,
  sinusoidalToLonLat,
} from './layers';

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

const R = 6371007.181;
const PIXEL = 926.625433;
const X0 = 5748784.185;
const Y0 = 4614594.658;

/** A 3 × 2 night grid near Tashkent, its third pixel without data. */
function nightJson(overrides: Record<string, unknown> = {}) {
  return {
    format: 'uzha-night-1',
    product: 'MYD11A2',
    band: 'LST_Night_1km',
    overpassLocal: '~01:30',
    period: 'июнь–август 2023–2025',
    composites: 25,
    minComposites: 5,
    grid: { projection: 'sinusoidal', radiusM: R, x0: X0, y0: Y0, pixelM: PIXEL, nx: 3, ny: 2 },
    bounds: [69.0, 41.4, 69.1, 41.5],
    stats: { min: 17, median: 18.5, max: 22 },
    values: [17, 18, null, 19, 20.5, 22],
    ...overrides,
  };
}

/** The lon/lat of a point of the test grid, given in pixels from its top-left corner. */
const at = (col: number, row: number) => sinusoidalToLonLat(parseNight(nightJson()), X0 + col * PIXEL, Y0 - row * PIXEL) as [number, number];

const withEnergy = { cells: { energy: { h: [] } } } as unknown as CityDetail;
const withoutEnergy = { cells: {} } as unknown as CityDetail;

describe('availableLayers', () => {
  it('always offers temperature, the fluxes with the energy step, the night with its file', () => {
    const night = parseNight(nightJson());
    expect(availableLayers(withEnergy, night)).toEqual(['lst', 'h', 'le', 'g', 'night']);
    expect(availableLayers(withEnergy, null)).toEqual(['lst', 'h', 'le', 'g']);
    expect(availableLayers(withoutEnergy, night)).toEqual(['lst', 'night']);
    expect(availableLayers(withoutEnergy, null)).toEqual(['lst']);
  });
});

describe('niceStep', () => {
  it('rounds up to a round step', () => {
    expect(niceStep(54)).toBe(60);
    expect(niceStep(50)).toBe(50);
    expect(niceStep(21)).toBe(25);
    expect(niceStep(4.2)).toBe(5);
    expect(niceStep(0.13)).toBeCloseTo(0.2);
    expect(niceStep(81)).toBe(100);
  });

  it('falls back to 1 when there is nothing to span', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });
});

describe('fluxLevels', () => {
  it('lays six round thresholds across the middle 90% of the cells', () => {
    const values = Array.from({ length: 101 }, (_, i) => i * 3); // 0…300 W/m², 5% tails at 15 and 285
    const levels = fluxLevels(values);
    expect(levels.thresholds).toEqual([0, 60, 120, 180, 240, 300]);
    expect(levels.major).toEqual([0, 120, 240]);
    expect(levels.neutral).toBe(3); // the median, 150, is in 120–180
  });

  it('keeps a few extreme cells from stretching the scale', () => {
    const values = [...Array.from({ length: 100 }, (_, i) => 100 + (i % 10)), 900, -400];
    const { thresholds } = fluxLevels(values);
    expect(thresholds[0]).toBeGreaterThanOrEqual(90);
    expect(thresholds[thresholds.length - 1]).toBeLessThanOrEqual(120);
  });

  it('survives a city where every cell gives the same', () => {
    const { thresholds } = fluxLevels([50, 50, 50]);
    expect(thresholds).toHaveLength(CLASS_COUNT - 1);
    expect(thresholds.every(Number.isFinite)).toBe(true);
  });
});

describe('legendClasses', () => {
  const levels = fluxLevels(Array.from({ length: 101 }, (_, i) => i * 3));

  it('lists the classes low to high with open ends', () => {
    const classes = legendClasses('h', levels);
    expect(classes).toHaveLength(CLASS_COUNT);
    expect(classes[0]).toEqual({ colour: 0, from: null, to: 0 });
    expect(classes[3]).toEqual({ colour: 3, from: 120, to: 180 });
    expect(classes[6]).toEqual({ colour: 6, from: 300, to: null });
  });

  it('turns the colours round for evaporation: more of it is cooler', () => {
    expect(legendClasses('le', levels).map((c) => c.colour)).toEqual([6, 5, 4, 3, 2, 1, 0]);
    expect(colourOf('le', 0)).toBe(6);
    expect(colourOf('g', 0)).toBe(0);
    expect(colourOf('night', 6)).toBe(6);
  });
});

describe('parseNight', () => {
  it('reads the grid, null pixels as NaN', () => {
    const night = parseNight(nightJson());
    expect(night).toMatchObject({ nx: 3, ny: 2, x0: X0, y0: Y0, pixelM: PIXEL, radiusM: R, overpassLocal: '~01:30', median: 18.5 });
    expect(Array.from(night.values.slice(0, 2))).toEqual([17, 18]);
    expect(Number.isNaN(night.values[2])).toBe(true);
  });

  it('works out the median when the file gives none', () => {
    expect(parseNight(nightJson({ stats: undefined })).median).toBe(19);
  });

  it('refuses a file of another format or with the wrong number of values', () => {
    expect(() => parseNight(nightJson({ format: 'other' }))).toThrow(DataContractError);
    expect(() => parseNight(nightJson({ values: [1, 2, 3] }))).toThrow(DataContractError);
    expect(() => parseNight(nightJson({ grid: { ...nightJson().grid, pixelM: 0 } }))).toThrow(DataContractError);
    expect(() => parseNight(null)).toThrow(DataContractError);
  });
});

describe('the night grid on the map', () => {
  const night = parseNight(nightJson());

  it('converts between lon/lat and the sinusoidal grid both ways', () => {
    const [lon, lat] = sinusoidalToLonLat(night, X0, Y0) as [number, number];
    expect(lat).toBeCloseTo(41.5, 3);
    expect(lon).toBeGreaterThan(69);
    const [x, y] = lonLatToSinusoidal(night, lon, lat);
    expect(x).toBeCloseTo(X0, 3);
    expect(y).toBeCloseTo(Y0, 3);
  });

  it('reads the pixel under a point, NaN where there is none', () => {
    expect(nightAt(night, ...at(1.5, 0.5))).toBe(18);
    expect(nightAt(night, ...at(0.5, 1.5))).toBe(19);
    expect(Number.isNaN(nightAt(night, ...at(2.5, 0.5)))).toBe(true); // no data
    expect(Number.isNaN(nightAt(night, ...at(-0.5, 0.5)))).toBe(true); // off the grid
    expect(Number.isNaN(nightAt(night, ...at(1.5, 2.5)))).toBe(true);
  });

  it('draws one exact quadrilateral per pixel with a value, never smoothed', () => {
    const { pixels, levels } = nightPixels(night);
    expect(levels).toEqual(nightLevels(night));
    expect(levels.thresholds).toEqual([17, 18, 19, 20, 21, 22]); // 1° steps, the median in the quiet class 2
    expect(pixels.features).toHaveLength(5);
    const first = pixels.features[0];
    expect(first?.properties).toEqual({ k: 1, c: 1, t: 17 });
    const ring = first?.geometry.coordinates[0] ?? [];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(at(0, 0));
    expect(ring[2]).toEqual(at(1, 1));
    expect(pixels.features.map((f) => f.properties.t)).toEqual([17, 18, 19, 20.5, 22]);
  });
});

describe('the published files', () => {
  it('every night file parses, and its pixels cover the city centre', () => {
    for (const id of ['tashkent', 'samarkand', 'bukhara']) {
      const night = parseNight(read(`../../public/data/night-${id}.json`));
      const finite = Array.from(night.values).filter((v) => !Number.isNaN(v));
      expect(finite.length).toBeGreaterThan(500);
      expect(night.median).toBeGreaterThan(10);
      expect(night.median).toBeLessThan(30);
      const city = (read('../../public/data/cities.json') as { id: string; center: [number, number] }[]).find((c) => c.id === id);
      expect(Number.isFinite(nightAt(night, ...(city?.center ?? [0, 0])))).toBe(true);
    }
  });

  it('a flux of a real city contours into the stacked bands, coloured by its own scale', () => {
    const detail = parseCityDetail(read('../../public/data/bukhara.json'));
    const grid = buildCellGrid(detail.cells.lon, detail.cells.lat, detail.grid.cellSizeM);
    const le = detail.cells.energy?.le ?? [];
    const overlay = fluxContours(grid, le, 'le');
    expect(overlay.bands.features.map((f) => f.properties)).toEqual(
      Array.from({ length: CLASS_COUNT }, (_, k) => ({ k, c: colourOf('le', k) })),
    );
    expect(overlay.levels).toEqual(fluxLevels(le));
    expect(overlay.lines.features.length).toBeGreaterThan(0);
    expect(fluxAt(detail, 'le', 0)).toBe(le[0]);
    expect(Number.isNaN(fluxAt({ cells: {} } as unknown as CityDetail, 'h', 0))).toBe(true);
  });
});
