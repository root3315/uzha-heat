import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { boundaryGeometry } from '../data/boundary';
import { parseCityDetail } from '../data/parse';
import { assembleCityModel, buildCityModel, builtHotCenter, citySurface } from './cityModel';
import { fineToSlot } from './field';
import { cellAt, slotToLonLat } from './grid';
import { pointInGeometry, quantile } from './stats';
import { hottestPatch, type LonLat } from './transect';

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

describe('citySurface', () => {
  it('survives the trip to a worker and back: the model built from a cloned surface is the same', () => {
    const detail = parseCityDetail(read('../../public/data/bukhara.json'));
    const outline = boundaryGeometry(read('../../public/boundaries/bukhara.geojson'));
    const direct = buildCityModel(detail, outline);
    const viaWorker = assembleCityModel(detail, outline, structuredClone(citySurface(detail, outline)));

    expect(viaWorker.isotherms).toEqual(direct.isotherms);
    expect(viaWorker.causeAreas).toEqual(direct.causeAreas);
    expect(viaWorker.field.values).toEqual(direct.field.values);
    expect(viaWorker.island).toEqual(direct.island);
    expect(viaWorker.facts).toEqual(direct.facts);
    expect(viaWorker.defaultTransect).toEqual(direct.defaultTransect);
  });

  it('lays the opening section where the search without remembered pixels does', () => {
    const detail = parseCityDetail(read('../../public/data/bukhara.json'));
    const outline = boundaryGeometry(read('../../public/boundaries/bukhara.geojson'));
    const surface = citySurface(detail, outline);
    const { field, grid, inside } = surface;
    const pop = detail.cells.pop;
    const median = pop ? quantile(pop.filter((_, i) => inside[i]), 0.5) : 0;
    const lived = (cell: number) => !pop || (cell >= 0 && (pop[cell] ?? 0) >= median);
    const toLonLat = (u: number, v: number): LonLat => slotToLonLat(field.grid, fineToSlot(field.factor, u), fineToSlot(field.factor, v));
    const livedAt = (u: number, v: number) => lived(cellAt(grid, ...toLonLat(u, v)));
    const allowed = (u: number, v: number) =>
      (field.coverage[v * field.fx + u] ?? 0) >= 0.99 && (!outline || pointInGeometry(toLonLat(u, v), outline)) && livedAt(u, v);
    const radius = Math.round((1000 / field.grid.cellSizeM) * field.factor);
    const hottest = hottestPatch(field.values, field.fx, field.fy, allowed, radius, { counted: livedAt, minShare: 0.5 });

    expect(hottest).not.toBeNull();
    const [u = 0, v = 0] = hottest ?? [];
    expect(surface.hotCenter).toEqual(toLonLat(u, v));
  });
});

describe('builtHotCenter', () => {
  it('picks the hottest built-up cell inside the outline', () => {
    const detail = {
      cells: { lst: [55, 50, 48, 60], lon: [0, 1, 2, 3], lat: [0, 0, 0, 0], values: { built: [10, 60, 80, 90] } },
    } as unknown as Parameters<typeof builtHotCenter>[0];
    // 55° is bare, 60° lies outside the outline: 50° is the hottest built-up cell inside.
    expect(builtHotCenter(detail, [true, true, true, false])).toEqual([1, 0]);
    expect(builtHotCenter(detail, [true, false, false, false])).toBeNull();
  });

  it('prefers crowded cells when population is known', () => {
    const detail = {
      cells: { lst: [50, 48, 47, 46], lon: [0, 1, 2, 3], lat: [0, 0, 0, 0], values: { built: [90, 90, 90, 90] }, pop: [5, 900, 800, 10] },
    } as unknown as Parameters<typeof builtHotCenter>[0];
    // 50° has almost nobody: the hottest of the crowded cells wins.
    expect(builtHotCenter(detail, [true, true, true, true])).toEqual([1, 0]);
  });
});
