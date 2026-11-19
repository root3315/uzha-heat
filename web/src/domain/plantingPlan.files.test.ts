import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boundaryGeometry } from '../data/boundary';
import { parseCityDetail, parseTreeModel } from '../data/parse';
import { parsePlanUncertainty } from '../data/planUncertainty';
import { insideMask } from './heatIsland';
import { plantingPlan } from './plantingPlan';

const root = join(__dirname, '../../public');
const read = (path: string): unknown => JSON.parse(readFileSync(join(root, path), 'utf-8'));
const spreadPath = join(root, 'data/plan-uncertainty.json');

/**
 * The pipeline writes how sure each place is (pipeline/uzha/plan.py, a port of the plan). It is only worth showing if
 * the port picks the very places the site picks, with the same cooling.
 */
describe('plan-uncertainty.json from the pipeline', () => {
  for (const city of ['tashkent', 'samarkand', 'bukhara']) {
    it.runIf(existsSync(spreadPath) && existsSync(join(root, `data/${city}.json`)))(`${city}: holds the site's own places and cooling`, () => {
      const detail = parseCityDetail(read(`data/${city}.json`));
      const model = parseTreeModel(read(`data/model-${city}.json`));
      const inside = insideMask(detail.cells.lon, detail.cells.lat, boundaryGeometry(read(`boundaries/${city}.geojson`)));
      const site = plantingPlan(model, detail, inside, 5);
      const file = parsePlanUncertainty(JSON.parse(readFileSync(spreadPath, 'utf-8')))[city];
      expect(file?.places.map((p) => p.cell)).toEqual(site.map((p) => p.cell));
      file?.places.forEach((p, i) => expect(Math.abs(p.cooling - (site[i]?.cooling ?? NaN))).toBeLessThan(1e-3));
    });
  }
});
