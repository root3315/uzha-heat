import type {
  BBox,
  CityDetail,
  CitySummary,
  ColumnsByFeature,
  District,
  FeatureMeta,
  GlobalImportance,
  GridInfo,
  LonLat,
  LstStats,
  ModelInfo,
  Period,
} from './contract';

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

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function requireObject(value: unknown, path: string): Json {
  if (!isObject(value)) throw new DataContractError(`${path} должен быть объектом`);
  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new DataContractError(`${path} должен быть массивом`);
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new DataContractError(`${path} должен быть строкой`);
  return value;
}

function requireNumber(value: unknown, path: string): number {
  if (!isNumber(value)) throw new DataContractError(`${path} должен быть числом`);
  return value;
}

function requireNumberArray(value: unknown, path: string): number[] {
  const array = requireArray(value, path);
  if (array.every(isNumber)) return array;
  throw new DataContractError(`${path}[${array.findIndex((v) => !isNumber(v))}] должен быть числом`);
}

function requireNumberTuple(value: unknown, length: number, path: string): number[] {
  const numbers = requireNumberArray(value, path);
  if (numbers.length !== length) throw new DataContractError(`${path} должен содержать ${length} числа`);
  return numbers;
}

function requireLonLat(value: unknown, path: string): LonLat {
  const [lon = 0, lat = 0] = requireNumberTuple(value, 2, path);
  return [lon, lat];
}

function requireBBox(value: unknown, path: string): BBox {
  const [w = 0, s = 0, e = 0, n = 0] = requireNumberTuple(value, 4, path);
  return [w, s, e, n];
}

function requireNumberRecord(value: unknown, path: string): Record<string, number> {
  const obj = requireObject(value, path);
  return Object.fromEntries(Object.entries(obj).map(([key, v]) => [key, requireNumber(v, `${path}.${key}`)]));
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

function parsePhoto(value: unknown, path: string): CitySummary['photo'] {
  if (value === undefined) return undefined;
  const photo = requireObject(value, path);
  return { url: requireString(photo.url, `${path}.url`), credit: requireString(photo.credit, `${path}.credit`) };
}

function parseCitySummary(value: unknown, path: string): CitySummary {
  const city = requireObject(value, path);
  return {
    id: requireString(city.id, `${path}.id`),
    name: requireString(city.name, `${path}.name`),
    nameEn: requireString(city.nameEn, `${path}.nameEn`),
    country: requireString(city.country, `${path}.country`),
    center: requireLonLat(city.center, `${path}.center`),
    bbox: requireBBox(city.bbox, `${path}.bbox`),
    photo: parsePhoto(city.photo, `${path}.photo`),
    lstMean: requireNumber(city.lstMean, `${path}.lstMean`),
    r2: requireNumber(city.r2, `${path}.r2`),
  };
}

function parseFeature(value: unknown, path: string): FeatureMeta {
  const feature = requireObject(value, path);
  return {
    key: requireString(feature.key, `${path}.key`),
    label: requireString(feature.label, `${path}.label`),
    unit: requireString(feature.unit, `${path}.unit`),
    description: requireString(feature.description, `${path}.description`),
  };
}

function parsePeriod(value: unknown): Period {
  const period = requireObject(value, 'period');
  return {
    label: requireString(period.label, 'period.label'),
    lstScenes: requireNumber(period.lstScenes, 'period.lstScenes'),
    s2Scenes: requireNumber(period.s2Scenes, 'period.s2Scenes'),
  };
}

function parseGrid(value: unknown): GridInfo {
  const grid = requireObject(value, 'grid');
  return {
    cellSizeM: requireNumber(grid.cellSizeM, 'grid.cellSizeM'),
    halfSizeDeg: requireLonLat(grid.halfSizeDeg, 'grid.halfSizeDeg'),
    count: requireNumber(grid.count, 'grid.count'),
  };
}

function parseModel(value: unknown): ModelInfo {
  const model = requireObject(value, 'model');
  return {
    type: requireString(model.type, 'model.type'),
    r2Cv: requireNumber(model.r2Cv, 'model.r2Cv'),
    maeCv: requireNumber(model.maeCv, 'model.maeCv'),
    cv: requireString(model.cv, 'model.cv'),
    baseValue: requireNumber(model.baseValue, 'model.baseValue'),
  };
}

function parseStats(value: unknown): LstStats {
  const stats = requireObject(value, 'stats');
  return {
    lstMean: requireNumber(stats.lstMean, 'stats.lstMean'),
    lstMin: requireNumber(stats.lstMin, 'stats.lstMin'),
    lstMax: requireNumber(stats.lstMax, 'stats.lstMax'),
    lstP10: requireNumber(stats.lstP10, 'stats.lstP10'),
    lstP90: requireNumber(stats.lstP90, 'stats.lstP90'),
  };
}

function parseImportance(value: unknown, path: string): GlobalImportance {
  const entry = requireObject(value, path);
  return {
    key: requireString(entry.key, `${path}.key`),
    meanAbsShap: requireNumber(entry.meanAbsShap, `${path}.meanAbsShap`),
    correlation: requireNumber(entry.correlation, `${path}.correlation`),
  };
}

function requireRings(value: unknown, path: string): LonLat[][] {
  return requireArray(value, path).map((ring, r) =>
    requireArray(ring, `${path}[${r}]`).map((point, p) => requireLonLat(point, `${path}[${r}][${p}]`)),
  );
}

function parseGeometry(value: unknown, path: string): District['geometry'] {
  const geometry = requireObject(value, path);
  const coordinatesPath = `${path}.coordinates`;
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: requireRings(geometry.coordinates, coordinatesPath) };
  }
  if (geometry.type === 'MultiPolygon') {
    const polygons = requireArray(geometry.coordinates, coordinatesPath);
    return { type: 'MultiPolygon', coordinates: polygons.map((rings, i) => requireRings(rings, `${coordinatesPath}[${i}]`)) };
  }
  throw new DataContractError(`${path}.type должен быть Polygon или MultiPolygon`);
}

function parseDistrict(value: unknown, path: string): District {
  const district = requireObject(value, path);
  return {
    name: requireString(district.name, `${path}.name`),
    geometry: parseGeometry(district.geometry, `${path}.geometry`),
    lstMean: requireNumber(district.lstMean, `${path}.lstMean`),
    cellCount: requireNumber(district.cellCount, `${path}.cellCount`),
    shapMean: district.shapMean === undefined ? {} : requireNumberRecord(district.shapMean, `${path}.shapMean`),
  };
}

export function parseCities(raw: unknown): CitySummary[] {
  return requireArray(raw, 'cities').map((entry, i) => parseCitySummary(entry, `cities[${i}]`));
}

export function parseCityDetail(raw: unknown): CityDetail {
  const root = requireObject(raw, 'город');
  const features = requireArray(root.features, 'features').map((f, i) => parseFeature(f, `features[${i}]`));
  const keys = features.map((f) => f.key);
  const cellsRaw = requireObject(root.cells, 'cells');
  const lon = requireNumberArray(cellsRaw.lon, 'cells.lon');
  const lat = requireNumberArray(cellsRaw.lat, 'cells.lat');
  const lst = requireNumberArray(cellsRaw.lst, 'cells.lst');
  if (lat.length !== lon.length || lst.length !== lon.length) {
    throw new DataContractError('cells.lon, cells.lat и cells.lst разной длины');
  }
  const districts = root.districts === undefined ? [] : requireArray(root.districts, 'districts');

  return {
    city: parseCitySummary(root.city, 'city'),
    period: parsePeriod(root.period),
    grid: parseGrid(root.grid),
    features,
    model: parseModel(root.model),
    stats: parseStats(root.stats),
    globalImportance: requireArray(root.globalImportance, 'globalImportance').map((g, i) =>
      parseImportance(g, `globalImportance[${i}]`),
    ),
    cells: {
      lon,
      lat,
      lst,
      values: requireColumns(cellsRaw.values, keys, lon.length, 'cells.values'),
      shap: requireColumns(cellsRaw.shap, keys, lon.length, 'cells.shap'),
    },
    districts: districts.map((d, i) => parseDistrict(d, `districts[${i}]`)),
  };
}
