// Types mirroring docs/data-contract.md. The app only reads these static files.

export type LonLat = [number, number];
export type BBox = [number, number, number, number];

/** Summer means at one ERA5 point near the city centre: m/s, %, kWh/m² a day, %, °C. */
export interface SummerWeather {
  windMs: number;
  humidityPct: number;
  solarKwhM2: number;
  cloudPct: number;
  airMeanC: number;
  /** Mean of the daily maxima. */
  airMaxC: number;
}

/** The same at the hours of the Landsat overpasses; solar radiation is the hourly mean, W/m². */
export interface OverpassWeather {
  days: number;
  localHour: number;
  windMs: number;
  humidityPct: number;
  solarWm2: number;
  cloudPct: number;
  airC: number;
}

/** Weather context for comparing cities: ERA5 is ~25 km, so it is not a factor inside a city. */
export interface Weather {
  source: string;
  period: string;
  point: LonLat;
  summer: SummerWeather;
  overpass?: OverpassWeather;
}

export interface CitySummary {
  id: string;
  name: string;
  nameEn: string;
  country: string;
  center: LonLat;
  bbox: BBox;
  photo?: { url: string; credit: string };
  lstMean: number;
  r2: number;
  weather?: Weather;
}

export interface FeatureMeta {
  key: string;
  label: string;
  unit: string;
  description: string;
}

export interface Period {
  label: string;
  lstScenes: number;
  s2Scenes: number;
}

export interface GridInfo {
  cellSizeM: number;
  halfSizeDeg: [number, number];
  count: number;
}

export interface ModelInfo {
  type: string;
  r2Cv: number;
  maeCv: number;
  cv: string;
  baseValue: number;
}

export interface LstStats {
  lstMean: number;
  lstMin: number;
  lstMax: number;
  lstP10: number;
  lstP90: number;
}

export interface GlobalImportance {
  key: string;
  meanAbsShap: number;
  correlation: number;
}

export type ColumnsByFeature = Record<string, number[]>;

export interface Cells {
  lon: number[];
  lat: number[];
  lst: number[];
  values: ColumnsByFeature;
  shap: ColumnsByFeature;
  /** People living in each cell (WorldPop, modelled); absent in data without the population step. */
  pop?: number[];
}

export interface Population {
  source: string;
  year: number;
  total: number;
}

export type FacilityType = 'school' | 'kindergarten' | 'clinic' | 'hospital';

export interface Facility {
  /** May be empty: not every school in OSM has a name. */
  name: string;
  type: FacilityType;
  lon: number;
  lat: number;
}

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: LonLat[][];
}

export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: LonLat[][][];
}

export interface District {
  name: string;
  geometry: PolygonGeometry | MultiPolygonGeometry;
  lstMean: number;
  cellCount: number;
  shapMean: Record<string, number>;
}

export interface CityDetail {
  city: CitySummary;
  period: Period;
  grid: GridInfo;
  features: FeatureMeta[];
  model: ModelInfo;
  stats: LstStats;
  globalImportance: GlobalImportance[];
  cells: Cells;
  districts: District[];
  population: Population | null;
  facilities: Facility[];
}
