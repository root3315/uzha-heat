import type { CityDetail, CitySummary, ColumnsByFeature, District, FeatureMeta } from './contract';

export class DataContractError extends Error {
  constructor(message: string) {
    super(`Данные не соответствуют контракту: ${message}`);
    this.name = 'DataContractError';
  }
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, path: string): Json {
  if (!isObject(value)) throw new DataContractError(`${path} должен быть объектом`);
  return value;
}

function requireNumberArray(value: unknown, path: string): number[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'number')) {
    throw new DataContractError(`${path} должен быть массивом чисел`);
  }
  return value as number[];
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new DataContractError(`${path} должен быть массивом`);
  return value;
}

function requireColumns(value: unknown, keys: string[], length: number, path: string): ColumnsByFeature {
  const obj = requireObject(value, path);
  return Object.fromEntries(
    keys.map((key) => {
      const column = requireNumberArray(obj[key], `${path}.${key}`);
      if (column.length !== length) throw new DataContractError(`${path}.${key}: длина ${column.length}, ожидалось ${length}`);
      return [key, column];
    }),
  );
}

/** Area-share factors are documented as "% площади"; accept 0–1 fractions too and rescale them. */
function normalizePercentColumns(features: FeatureMeta[], values: ColumnsByFeature): ColumnsByFeature {
  const result: ColumnsByFeature = { ...values };
  for (const feature of features) {
    const column = values[feature.key];
    if (!feature.unit.includes('%') || !column) continue;
    const max = column.reduce((m, v) => Math.max(m, v), -Infinity);
    if (max <= 1) result[feature.key] = column.map((v) => v * 100);
  }
  return result;
}

export function parseCities(raw: unknown): CitySummary[] {
  return requireArray(raw, 'cities.json').map((entry, i) => {
    const city = requireObject(entry, `cities[${i}]`);
    if (typeof city.id !== 'string' || typeof city.name !== 'string') {
      throw new DataContractError(`cities[${i}] без id или name`);
    }
    return city as unknown as CitySummary;
  });
}

export function parseCityDetail(raw: unknown): CityDetail {
  const root = requireObject(raw, 'город');
  const features = requireArray(root.features, 'features') as FeatureMeta[];
  const keys = features.map((f) => f.key);
  const cellsRaw = requireObject(root.cells, 'cells');
  const lon = requireNumberArray(cellsRaw.lon, 'cells.lon');
  const lat = requireNumberArray(cellsRaw.lat, 'cells.lat');
  const lst = requireNumberArray(cellsRaw.lst, 'cells.lst');
  if (lat.length !== lon.length || lst.length !== lon.length) {
    throw new DataContractError('cells.lon, cells.lat и cells.lst разной длины');
  }
  const values = normalizePercentColumns(features, requireColumns(cellsRaw.values, keys, lon.length, 'cells.values'));
  const shap = requireColumns(cellsRaw.shap, keys, lon.length, 'cells.shap');
  const districts = root.districts === undefined ? [] : (requireArray(root.districts, 'districts') as District[]);

  return {
    city: requireObject(root.city, 'city') as unknown as CityDetail['city'],
    period: requireObject(root.period, 'period') as unknown as CityDetail['period'],
    grid: requireObject(root.grid, 'grid') as unknown as CityDetail['grid'],
    features,
    model: requireObject(root.model, 'model') as unknown as CityDetail['model'],
    stats: requireObject(root.stats, 'stats') as unknown as CityDetail['stats'],
    globalImportance: requireArray(root.globalImportance, 'globalImportance') as CityDetail['globalImportance'],
    cells: { lon, lat, lst, values, shap },
    districts,
  };
}
