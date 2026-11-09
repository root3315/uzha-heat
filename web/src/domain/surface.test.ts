import { describe, expect, it } from 'vitest';
import { buildField, coverageOf, fieldAt, fillEmpty, upsample } from './field';
import { buildCellGrid, cellAt, rasterize, slotToLonLat } from './grid';
import { anchorIndices, classOf, classShares, isothermGeometry, isothermLevels, outsideOf } from './isotherms';
import { fromUtm, toUtm } from './utm';

const CELL = 200;

/** Cells on a real UTM 42N grid near Tashkent, `cols × rows`, minus any `missing` [col, row]. */
function utmCells(cols: number, rows: number, temperature: (c: number, r: number) => number, missing: [number, number][] = []) {
  const lon: number[] = [];
  const lat: number[] = [];
  const lst: number[] = [];
  const skip = new Set(missing.map(([c, r]) => `${c}:${r}`));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (skip.has(`${c}:${r}`)) continue;
      const [x, y] = [470_100 + c * CELL, 4_570_100 - r * CELL];
      const [lo, la] = fromUtm(x, y, 42);
      lon.push(Number(lo.toFixed(5)));
      lat.push(Number(la.toFixed(5)));
      lst.push(temperature(c, r));
    }
  }
  return { lon, lat, lst };
}

describe('buildCellGrid', () => {
  it('snaps every cell to its own slot, even after rounding coordinates to 5 decimals', () => {
    const { lon, lat } = utmCells(12, 9, () => 40);
    const grid = buildCellGrid(lon, lat, CELL, 2);
    expect(grid.nx).toBe(12 + 4);
    expect(grid.ny).toBe(9 + 4);
    const occupied = Array.from(grid.index).filter((i) => i >= 0);
    expect(new Set(occupied).size).toBe(lon.length);
  });

  it('puts the first row at the top and finds cells by coordinate', () => {
    const { lon, lat } = utmCells(4, 3, () => 40);
    const grid = buildCellGrid(lon, lat, CELL, 1);
    expect(grid.index[1 * grid.nx + 1]).toBe(0);
    expect(cellAt(grid, lon[5] ?? 0, lat[5] ?? 0)).toBe(5);
    const [lo, la] = slotToLonLat(grid, 1, 1);
    expect(lo).toBeCloseTo(lon[0] ?? 0, 4);
    expect(la).toBeCloseTo(lat[0] ?? 0, 4);
  });

  it('returns −1 away from the data', () => {
    const { lon, lat } = utmCells(4, 3, () => 40, [[2, 1]]);
    const grid = buildCellGrid(lon, lat, CELL, 1);
    const [x, y] = [470_100 + 2 * CELL, 4_570_100 - 1 * CELL];
    expect(cellAt(grid, ...fromUtm(x, y, 42))).toBe(-1);
    expect(cellAt(grid, 60, 30)).toBe(-1);
  });
});

describe('fillEmpty', () => {
  it('fills holes from their neighbours and never invents values below or above the data', () => {
    const raster = Float32Array.from([40, 42, Number.NaN, 44, Number.NaN, Number.NaN, 46, 48, Number.NaN]);
    const filled = fillEmpty(raster, 3, 3);
    expect(filled.every((v) => Number.isFinite(v))).toBe(true);
    expect(Math.min(...filled)).toBeGreaterThanOrEqual(40);
    expect(Math.max(...filled)).toBeLessThanOrEqual(48);
  });

  it('leaves a raster with no data at all untouched', () => {
    const filled = fillEmpty(Float32Array.from([Number.NaN, Number.NaN]), 2, 1);
    expect(filled.every((v) => Number.isNaN(v))).toBe(true);
  });
});

describe('field edge', () => {
  it('keeps the edge of the data at data temperatures instead of dragging it towards zero', () => {
    const { lon, lat, lst } = utmCells(10, 10, () => 45);
    const grid = buildCellGrid(lon, lat, CELL);
    const field = buildField(grid, lst);
    expect(Math.min(...field.values)).toBeCloseTo(45, 3);
    expect(fieldAt(field, lon[9] ?? 0, lat[9] ?? 0)).toBeCloseTo(45, 3);
  });

  it('marks only covered slots, closing single missing cells', () => {
    const { lon, lat } = utmCells(5, 5, () => 40, [[2, 2]]);
    const grid = buildCellGrid(lon, lat, CELL, 1);
    const cover = coverageOf(grid);
    expect(cover[3 * grid.nx + 3]).toBe(1);
    expect(cover[0]).toBe(0);
    expect(Array.from(cover).filter((v) => v === 1)).toHaveLength(25);
  });

  it('upsamples with pixel centres aligned to cell centres', () => {
    const fine = upsample(Float32Array.from([0, 10]), 2, 1, 4);
    expect(fine[0]).toBe(0);
    expect(fine[7]).toBe(10);
    expect(fine[3]).toBeCloseTo(3.75);
  });
});

describe('isotherm levels', () => {
  it('puts the city mean in the neutral class and steps by 2°', () => {
    const levels = isothermLevels(43.78);
    expect(levels.thresholds).toEqual([40, 42, 44, 46, 48, 50]);
    expect(classOf(levels, 43.78)).toBe(levels.neutral);
    expect(levels.major).toEqual([44, 48]);
  });

  it('classifies the edges and shares by area', () => {
    const levels = isothermLevels(43);
    expect(classOf(levels, 30)).toBe(0);
    expect(classOf(levels, 40)).toBe(1);
    expect(classOf(levels, 60)).toBe(6);
    const shares = classShares(levels, [30, 41, 41, 43, 60]);
    expect(shares).toEqual([0.2, 0.4, 0.2, 0, 0, 0, 0.2]);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe('isothermGeometry', () => {
  const { lon, lat, lst } = utmCells(30, 20, (c) => 36 + c * 0.6);
  const grid = buildCellGrid(lon, lat, CELL);
  const field = buildField(grid, lst);
  const levels = isothermLevels(44);
  const geometry = isothermGeometry(field, levels, { labelSpacingM: 1000, minLabelledRingM: 500 });

  it('draws a stacked band per class, starting with the data coverage', () => {
    expect(geometry.bands.features.map((f) => f.properties.k)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(geometry.coverage.coordinates.length).toBeGreaterThan(0);
  });

  it('keeps the coverage inside the data extent plus half a cell', () => {
    const [x0] = toUtm(lon[0] ?? 0, lat[0] ?? 0, 42);
    const xs = geometry.coverage.coordinates.flat(2).map(([lo = 0, la = 0]) => toUtm(lo, la, 42)[0]);
    expect(Math.min(...xs)).toBeGreaterThan(x0 - CELL / 2 - 1);
  });

  it('labels the isolines that cross the data', () => {
    expect(geometry.lines.features.length).toBeGreaterThan(0);
    expect(geometry.anchors.length).toBeGreaterThan(0);
    expect(geometry.anchors.every((a) => levels.thresholds.includes(a.t))).toBe(true);
  });
});

describe('anchorIndices', () => {
  const ring: [number, number][] = Array.from({ length: 101 }, (_, i) => [i / 10, 0]);

  it('spaces labels evenly along a line, starting half a spacing in', () => {
    expect(anchorIndices(ring, 200, 1000, 100)).toEqual([25, 75]);
  });

  it('skips short rings', () => {
    expect(anchorIndices(ring, 200, 1000, 5000)).toEqual([]);
  });
});

describe('outsideOf', () => {
  it('cuts the area out of the world and fills its holes back in', () => {
    const outer = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    const hole = [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.4, 0.4]];
    const mask = outsideOf({ type: 'Polygon', coordinates: [outer, hole] });
    expect(mask.features).toHaveLength(2);
    expect(mask.features[0]?.geometry.coordinates[1]).toEqual(outer);
    expect(mask.features[1]?.geometry.coordinates[0]).toEqual(hole);
  });
});

describe('rasterize', () => {
  it('leaves empty slots as NaN', () => {
    const { lon, lat, lst } = utmCells(2, 1, (c) => 40 + c);
    const grid = buildCellGrid(lon, lat, CELL, 1);
    const raster = rasterize(grid, lst);
    expect(raster[grid.nx + 1]).toBe(40);
    expect(raster[grid.nx + 2]).toBe(41);
    expect(Number.isNaN(raster[0] ?? 0)).toBe(true);
  });
});
