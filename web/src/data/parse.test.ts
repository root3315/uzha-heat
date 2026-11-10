import { describe, expect, it } from 'vitest';
import { DataContractError, parseCities, parseCityDetail } from './parse';

const city = {
  id: 'test',
  name: 'Тест',
  nameEn: 'Test',
  country: 'Узбекистан',
  center: [69.2, 41.3],
  bbox: [69.1, 41.2, 69.4, 41.4],
  lstMean: 44,
  r2: 0.7,
};

function validDetail() {
  return {
    city,
    period: { label: 'лето', lstScenes: 9, s2Scenes: 6 },
    grid: { cellSizeM: 200, halfSizeDeg: [0.0012, 0.0009], count: 2 },
    features: [{ key: 'ndvi', label: 'Растительность', unit: 'NDVI', description: '' }],
    model: { type: 'XGBoost', r2Cv: 0.7, maeCv: 1.1, cv: 'spatial', baseValue: 44 },
    stats: { lstMean: 44, lstMin: 40, lstMax: 48, lstP10: 41, lstP90: 47 },
    globalImportance: [{ key: 'ndvi', meanAbsShap: 1.2, correlation: -0.6 }],
    cells: {
      lon: [69.2, 69.21],
      lat: [41.3, 41.31],
      lst: [43, 45],
      values: { ndvi: [0.4, 0.1] },
      shap: { ndvi: [-1, 1] },
    },
    districts: [
      {
        name: 'Район',
        geometry: { type: 'Polygon', coordinates: [[[69.1, 41.2], [69.3, 41.2], [69.3, 41.4], [69.1, 41.2]]] },
        lstMean: 44,
        cellCount: 2,
      },
    ],
  };
}

function errorOf(parse: () => unknown): DataContractError {
  try {
    parse();
  } catch (error) {
    if (error instanceof DataContractError) return error;
    throw error;
  }
  throw new Error('expected a DataContractError');
}

describe('parseCityDetail', () => {
  it('accepts a valid dataset and defaults a missing shapMean to an empty object', () => {
    const detail = parseCityDetail(validDetail());
    expect(detail.cells.lst).toEqual([43, 45]);
    expect(detail.districts[0]?.shapMean).toEqual({});
  });

  it('treats absent districts as an empty list', () => {
    const { districts: _, ...withoutDistricts } = validDetail();
    expect(parseCityDetail(withoutDistricts).districts).toEqual([]);
  });

  it('names the offending feature field', () => {
    const raw = { ...validDetail(), features: [{ key: 'ndvi', label: 'Растительность', unit: 'NDVI' }] };
    expect(errorOf(() => parseCityDetail(raw)).message).toContain('features[0].description');
  });

  it('rejects a non-numeric grid size', () => {
    const raw = { ...validDetail(), grid: { cellSizeM: '200', halfSizeDeg: [0.0012, 0.0009], count: 2 } };
    expect(errorOf(() => parseCityDetail(raw)).message).toContain('grid.cellSizeM');
  });

  it('rejects an unsupported district geometry type', () => {
    const raw = validDetail();
    const district = { ...raw.districts[0], geometry: { type: 'Point', coordinates: [69.2, 41.3] } };
    expect(errorOf(() => parseCityDetail({ ...raw, districts: [district] })).message).toContain('districts[0].geometry.type');
  });

  it('rejects a shapMean that is not a number map', () => {
    const raw = validDetail();
    const district = { ...raw.districts[0], shapMean: { ndvi: 'high' } };
    expect(errorOf(() => parseCityDetail({ ...raw, districts: [district] })).message).toContain('districts[0].shapMean.ndvi');
  });

  it('reads optional population and facilities, and defaults them when absent', () => {
    const raw = validDetail();
    const withPeople = {
      ...raw,
      cells: { ...raw.cells, pop: [120, 0] },
      population: { source: 'WorldPop', year: 2025, total: 120 },
      facilities: [{ name: '', type: 'school', lon: 69.2, lat: 41.3 }],
    };
    const detail = parseCityDetail(withPeople);
    expect(detail.cells.pop).toEqual([120, 0]);
    expect(detail.population?.year).toBe(2025);
    expect(detail.facilities).toEqual([{ name: '', type: 'school', lon: 69.2, lat: 41.3 }]);
    const plain = parseCityDetail(raw);
    expect(plain.cells.pop).toBeUndefined();
    expect(plain.population).toBeNull();
    expect(plain.facilities).toEqual([]);
  });

  it('rejects a population column of the wrong length and an unknown facility type', () => {
    const raw = validDetail();
    expect(errorOf(() => parseCityDetail({ ...raw, cells: { ...raw.cells, pop: [1] } })).message).toContain('cells.pop');
    const shop = [{ name: 'Магазин', type: 'shop', lon: 69.2, lat: 41.3 }];
    expect(errorOf(() => parseCityDetail({ ...raw, facilities: shop })).message).toContain('facilities[0].type');
  });

  it('rejects cell columns of the wrong length', () => {
    const raw = validDetail();
    raw.cells.shap = { ndvi: [1] };
    expect(errorOf(() => parseCityDetail(raw)).message).toContain('cells.shap.ndvi');
  });
});

describe('parseCities', () => {
  it('validates every entry', () => {
    expect(parseCities([city])).toHaveLength(1);
    expect(errorOf(() => parseCities([city, { ...city, bbox: [1, 2, 3] }])).message).toContain('cities[1].bbox');
  });
});

describe('city weather', () => {
  const weather = {
    source: 'ERA5 (Copernicus) via Open-Meteo',
    period: 'июнь–август 2023–2025',
    point: [69.25, 41.25],
    summer: { windMs: 1.9, humidityPct: 42.5, solarKwhM2: 7.3, cloudPct: 15.3, airMeanC: 27.1, airMaxC: 34.3 },
    overpass: { days: 20, localHour: 11, windMs: 1.5, humidityPct: 31, solarWm2: 799, cloudPct: 0.3, airC: 32 },
  };

  it('reads it when present and leaves it out when absent', () => {
    const [parsed] = parseCities([{ ...city, weather }]);
    expect(parsed?.weather?.summer.windMs).toBe(1.9);
    expect(parsed?.weather?.overpass?.days).toBe(20);
    expect(parseCities([city])[0]?.weather).toBeUndefined();
    const { overpass: _, ...withoutOverpass } = weather;
    expect(parseCities([{ ...city, weather: withoutOverpass }])[0]?.weather?.overpass).toBeUndefined();
  });

  it('names a missing summer value', () => {
    const broken = { ...weather, summer: { ...weather.summer, airMaxC: 'жарко' } };
    expect(errorOf(() => parseCities([{ ...city, weather: broken }])).message).toContain('cities[0].weather.summer.airMaxC');
  });
});

describe('energy balance', () => {
  const cellsEnergy = { sAbs: [650, 610], rn: [520, 400], g: [60, 100], h: [100, 280], le: [360, 20] };
  const method = {
    localHour: 11,
    solarWm2: 799,
    airC: 32,
    humidityPct: 31,
    longwaveDownWm2: 395,
    hotAnchorC: 52.5,
    coldAnchorC: 32.4,
    mean: { sAbs: 630, rn: 460, g: 80, h: 190, le: 190 },
    surfaces: [{ key: 'asphalt', label: 'Асфальт', heatCapacity: 1.94, conductivity: 0.75, admittance: 1205 }],
  };

  it('reads the per-cell fluxes and the method together, and leaves both out when absent', () => {
    const raw = validDetail();
    const detail = parseCityDetail({ ...raw, cells: { ...raw.cells, energy: cellsEnergy }, energy: method });
    expect(detail.cells.energy?.le).toEqual([360, 20]);
    expect(detail.energy?.mean.rn).toBe(460);
    expect(detail.energy?.surfaces[0]?.admittance).toBe(1205);
    const plain = parseCityDetail(raw);
    expect(plain.cells.energy).toBeUndefined();
    expect(plain.energy).toBeNull();
  });

  it('rejects half of it, a short column and a broken surface', () => {
    const raw = validDetail();
    expect(errorOf(() => parseCityDetail({ ...raw, energy: method })).message).toContain('cells.energy');
    const short = { ...cellsEnergy, h: [100] };
    expect(errorOf(() => parseCityDetail({ ...raw, cells: { ...raw.cells, energy: short }, energy: method })).message).toContain('cells.energy.h');
    const broken = { ...method, surfaces: [{ key: 'asphalt', label: 'Асфальт', heatCapacity: 1.94 }] };
    expect(errorOf(() => parseCityDetail({ ...raw, cells: { ...raw.cells, energy: cellsEnergy }, energy: broken })).message).toContain(
      'energy.surfaces[0].conductivity',
    );
  });
});
