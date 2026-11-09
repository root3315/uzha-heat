// Types mirroring docs/data-contract.md. The app only reads these static files.

export type LonLat = [number, number];
export type BBox = [number, number, number, number];

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
}
