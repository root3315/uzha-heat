import { describe, expect, it } from 'vitest';
import { columnAt, parseSeb } from './seb';

const TILES = ['tree', 'grass', 'bare', 'roof', 'road', 'paved', 'water'];
const column = (values: number[], offset = 0, step = 0.001) => ({ offset, step, values });

/** A two-cell file in the exported shape. */
function smallSeb(): Record<string, unknown> {
  return {
    format: 'uzha-seb-1',
    tiles: TILES,
    cells: 2,
    params: { kbInv: 6.4, rsMinTree: 40, rsMinGrass: 34, rsMinCrop: 20.6, soilResistanceScale: 0.5, ohmA1Scale: 1.2, dTAir: 4.6, dTAirUrban: 4.8 },
    forcing: {
      kDown: 840.5,
      diffuseFraction: 0.16,
      eAir: 1.45,
      wind: 2.13,
      zRef: 60,
      zenith: 0.527,
      dkDt: 66.7,
      tAir: column([0, 140], 304.27, 0.01),
      lDown: column([0, 70], 390.2, 0.1),
      pressure: column([0, 230], 94.3, 0.01),
    },
    tile: {
      emissivity: [0.98, 0.95, 0.93, 0.91, 0.95, 0.9, 0.96],
      ohm: TILES.map(() => [0.5, 0.3, -30]),
      albedo: { tree: 0.16, grass: 0.21, bare: 0.25, water: 0.08 },
      imperviousTiles: ['roof', 'road', 'paved'],
      canyonTiles: ['road', 'paved', 'grass', 'bare'],
    },
    cell: {
      fraction: {
        tree: column([100, 0]),
        grass: column([100, 0]),
        bare: 0,
        roof: column([400, 0]),
        road: column([200, 0]),
        paved: column([200, 0]),
        water: column([0, 1000]),
      },
      imperviousAlbedo: column([180, 180]),
      canyonShade: column([300, 0]),
      skyView: column([600, 1000]),
      z0m: column([80000, 20], 0, 0.00001),
      zd: column([800, 0], 0, 0.01),
      soilMoisture: 0.21,
      qf: column([300, 0], 0, 0.1),
      irrigated: column([1, 0], 0, 1),
      rural: column([0, 1], 0, 1),
    },
    check: { cells: [0], tCell: [318.2] },
    roundingK: 0.03,
  };
}

describe('parseSeb', () => {
  it('reads the exported shape', () => {
    const seb = parseSeb(smallSeb());
    expect(seb).not.toBeNull();
    expect(seb?.cells).toBe(2);
    expect(seb?.params.dTAir).toBe(4.6);
    expect(seb?.check).toEqual({ cells: [0], tCell: [318.2] });
  });

  it('decodes a column as offset + step × int, and a number as the same value everywhere', () => {
    expect(columnAt({ offset: 304.27, step: 0.01, values: [0, 140] }, 1)).toBeCloseTo(305.67, 10);
    expect(columnAt(0.21, 1)).toBe(0.21);
  });

  it('ignores unknown keys and a broken check', () => {
    const raw = { ...smallSeb(), extra: { anything: true }, check: { cells: [5], tCell: [1] } };
    const seb = parseSeb(raw);
    expect(seb).not.toBeNull();
    expect(seb?.check).toBeNull();
  });

  it('refuses a file the solver cannot use', () => {
    const noParams = { ...smallSeb(), params: { kbInv: 6 } };
    expect(parseSeb(noParams)).toBeNull();
    const short = smallSeb();
    (short.cell as Record<string, unknown>).qf = column([1]);
    expect(parseSeb(short)).toBeNull();
    const noAlbedo = smallSeb();
    (noAlbedo.tile as Record<string, unknown>).albedo = { tree: 0.16 };
    expect(parseSeb(noAlbedo)).toBeNull();
    expect(parseSeb(null)).toBeNull();
    expect(parseSeb({ cells: 2 })).toBeNull();
  });
});
