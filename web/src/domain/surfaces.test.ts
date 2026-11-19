import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSeb, type SebCity } from '../data/seb';
import { solveCell } from './seb/solve';
import { DEFAULT_PARAMS, TILE, type CellForcing, type CellInputs } from './seb/types';
import {
  ROAD_ALBEDO_TARGET,
  ROOF_ALBEDO_TARGET,
  applySurfaces,
  mayHaveSurfaces,
  surfaceCell,
  surfaceLevers,
  surfaceWhatIf,
  type SurfaceCell,
} from './surfaces';

const OHM = [
  [0.11, 0.11, -12.3],
  [0.32, 0.54, -27.4],
  [0.35, 0.43, -36.5],
  [0.48, 0.34, -33.9],
  [0.61, 0.41, -27.7],
  [0.83, 0.4, -54.2],
  [0.5, 0.21, -39.1],
] as const;

/** A dense city block: roofs, roads, paving and a little grass and tree, at a Tashkent overpass. */
const BLOCK: CellInputs = {
  fraction: [0.1, 0.1, 0.0, 0.4, 0.2, 0.2, 0.0],
  albedo: [0.16, 0.21, 0.25, 0.18, 0.18, 0.18, 0.08],
  emissivity: [0.98, 0.95, 0.93, 0.91, 0.95, 0.9, 0.96],
  shade: [0, 0.3, 0.3, 0, 0.3, 0.3, 0],
  skyView: 0.6,
  z0m: 0.8,
  zd: 8,
  soilMoisture: 0.21,
  irrigated: true,
  ohm: OHM,
  qf: 30,
  rural: false,
};
const WEATHER: CellForcing = { kDown: 840.5, diffuseFraction: 0.16, lDown: 393, tAir: 305, eAir: 1.45, pressure: 95.5, wind: 2.13, zRef: 60, zenith: 0.527, dkDt: 66.7 };
const CELL: SurfaceCell = { inputs: BLOCK, forcing: WEATHER, params: { ...DEFAULT_PARAMS, dTAir: 4.6 } };

describe('surfaceLevers', () => {
  it('offers roof and road albedo from the cell as it is, and green roofs from none', () => {
    expect(surfaceLevers(BLOCK)).toEqual([
      { key: 'roofAlbedo', from: 0.18, to: ROOF_ALBEDO_TARGET, step: 0.01 },
      { key: 'roadAlbedo', from: 0.18, to: ROAD_ALBEDO_TARGET, step: 0.01 },
      { key: 'greenRoofs', from: 0, to: 1, step: 0.05 },
    ]);
  });

  it('offers nothing for roofs where there are none, and no road lever for a road already that bright', () => {
    const park = { ...BLOCK, fraction: [0.5, 0.4, 0.0, 0.0, 0.1, 0.0, 0.0], albedo: BLOCK.albedo.map((a, k) => (k === TILE.road ? 0.45 : a)) };
    expect(surfaceLevers(park)).toEqual([]);
  });
});

describe('applySurfaces', () => {
  it('sets roof and road albedo and turns a share of the roofs into watered grass, keeping the shares summing to 1', () => {
    const changed = applySurfaces(BLOCK, { roofAlbedo: 0.6, roadAlbedo: 0.35, greenRoofs: 0.5 });
    expect(changed.albedo[TILE.roof]).toBe(0.6);
    expect(changed.albedo[TILE.road]).toBe(0.35);
    expect(changed.albedo[TILE.paved]).toBe(0.18);
    expect(changed.fraction[TILE.roof]).toBeCloseTo(0.2, 12);
    expect(changed.fraction[TILE.grass]).toBeCloseTo(0.3, 12);
    expect(changed.fraction.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(changed.irrigated).toBe(true);
  });

  it('leaves the cell alone without settings', () => {
    expect(applySurfaces(BLOCK, {})).toBe(BLOCK);
  });
});

describe('surfaceWhatIf', () => {
  it('is no change without settings', () => {
    const result = surfaceWhatIf(CELL, {});
    expect(result.delta).toBe(0);
    expect(result.treated).toBeNull();
    expect(result.treatedShare).toBe(0);
    expect(result.converged).toBe(true);
  });

  it('cools the cell with brighter roofs, the roofs themselves much more than the whole cell', () => {
    const result = surfaceWhatIf(CELL, { roofAlbedo: ROOF_ALBEDO_TARGET });
    expect(result.delta).toBeLessThan(-0.5);
    expect(result.treated).not.toBeNull();
    expect(result.treated!).toBeLessThan(result.delta);
    expect(result.treatedShare).toBeCloseTo(0.4, 12);
    expect(result.after - result.before).toBeCloseTo(result.delta, 12);
  });

  it('matches whatIfCell-style solving: the cell temperature after is the solver on the changed inputs', () => {
    const settings = { roofAlbedo: 0.5, roadAlbedo: 0.3, greenRoofs: 0.4 };
    const expected = solveCell(applySurfaces(BLOCK, settings), WEATHER, CELL.params).tCell - solveCell(BLOCK, WEATHER, CELL.params).tCell;
    const result = surfaceWhatIf(CELL, settings);
    expect(result.delta).toBeCloseTo(expected, 12);
    // Roofs (the 60 % left), greened roofs and roads.
    expect(result.treatedShare).toBeCloseTo(0.4 * 0.6 + 0.4 * 0.4 + 0.2, 12);
  });

  it('cools more the more roof is greened', () => {
    const some = surfaceWhatIf(CELL, { greenRoofs: 0.3 }).delta;
    const all = surfaceWhatIf(CELL, { greenRoofs: 1 }).delta;
    expect(some).toBeLessThan(0);
    expect(all).toBeLessThan(some);
  });
});

describe('mayHaveSurfaces', () => {
  it('reads the built-up share and road density of the city file', () => {
    const values = { built: [0, 40, 0], roads: [0, 0, 3.2] };
    expect([0, 1, 2].map((cell) => mayHaveSurfaces(values, cell))).toEqual([false, true, true]);
    expect(mayHaveSurfaces({ ndvi: [0.2] }, 0)).toBe(true);
  });
});

const dataDir = join(__dirname, '../../public/data');

describe.each(['tashkent', 'samarkand', 'bukhara'])('seb-%s.json', (city) => {
  const path = join(dataDir, `seb-${city}.json`);
  const run = existsSync(path) ? it : it.skip;
  let seb: SebCity | null = null;
  const load = () => (seb ??= parseSeb(JSON.parse(readFileSync(path, 'utf-8'))));

  run('parses, with check rows', () => {
    const parsed = load();
    expect(parsed).not.toBeNull();
    expect(parsed!.check?.cells.length).toBeGreaterThanOrEqual(3);
  });

  run("reproduces the pipeline's own cell temperature on every check row", () => {
    const parsed = load()!;
    const { cells, tCell } = parsed.check!;
    cells.forEach((cell, i) => {
      const place = surfaceCell(parsed, cell);
      expect(place, `cell ${cell}`).not.toBeNull();
      const state = solveCell(place!.inputs, place!.forcing, place!.params);
      expect(Math.abs(state.tCell - tCell[i]!), `cell ${cell}`).toBeLessThan(1e-5);
    });
  });

  run('offers roof changes on the built-up check cells', () => {
    const parsed = load()!;
    const built = parsed.check!.cells.map((cell) => surfaceCell(parsed, cell)!).filter((place) => !place.inputs.rural);
    expect(built.length).toBeGreaterThan(0);
    for (const place of built) {
      expect(surfaceLevers(place.inputs).map((lever) => lever.key)).toContain('greenRoofs');
      expect(surfaceWhatIf(place, { greenRoofs: 1 }).delta).toBeLessThan(0);
    }
  });

  run('has no cell outside the file', () => {
    const parsed = load()!;
    expect(surfaceCell(parsed, parsed.cells)).toBeNull();
    expect(surfaceCell(parsed, -1)).toBeNull();
  });
});
