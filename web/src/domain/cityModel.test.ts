import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { boundaryGeometry } from '../data/load';
import { parseCityDetail } from '../data/parse';
import { assembleCityModel, buildCityModel, citySurface } from './cityModel';

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
});
