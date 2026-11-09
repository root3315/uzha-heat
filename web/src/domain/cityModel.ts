import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { CityDetail } from '../data/contract';
import { cityFacts, type CityFacts } from './answers';
import { causeAreas, type CauseAreaProperties } from './causeAreas';
import { heatIslandIntensity, insideMask, type HeatIsland } from './heatIsland';
import { buildField, fieldAt, fineToSlot, type Field } from './field';
import { buildCellGrid, cellAt, slotToLonLat, type CellGrid } from './grid';
import { classShares, isothermGeometry, isothermLevels, type IsothermGeometry, type IsothermLevels } from './isotherms';
import { cityFactorMeans, dominantFactorPerCell, hotspotProfile, type FactorMeans, type PlaceProfile } from './places';
import { pointInGeometry } from './stats';
import { defaultTransect, hottestPatch, type LonLat, type Transect, type TransectSource } from './transect';
import { fromUtm, toUtm } from './utm';

export type Outline = Polygon | MultiPolygon;

/** Everything derived once per city: the surface, its isotherms and the defaults the screen opens with. */
export interface CityModel {
  detail: CityDetail;
  outline: Outline | null;
  grid: CellGrid;
  field: Field;
  levels: IsothermLevels;
  /** Share of the city's area in each temperature class. */
  shares: number[];
  isotherms: IsothermGeometry;
  causeAreas: FeatureCollection<MultiPolygon, CauseAreaProperties>;
  source: TransectSource;
  hotspot: PlaceProfile;
  facts: CityFacts;
  /** Per cell: inside the city outline. */
  inside: boolean[];
  island: HeatIsland | null;
  cityMeans: FactorMeans;
  defaultTransect: Transect;
}

/** About a kilometre either way, in fine pixels, for finding the hottest neighbourhood. */
const HOT_PATCH_RADIUS_M = 1000;
/** Fine pixels this covered count as inside the data. */
const COVERED = 0.99;

function transectSource(detail: CityDetail, grid: CellGrid, field: Field, outline: Outline | null): TransectSource {
  const keys = detail.features.map((f) => f.key);
  const { shap } = detail.cells;
  return {
    toMetres: ([lon, lat]) => toUtm(lon, lat, grid.zone),
    fromMetres: ([x, y]) => fromUtm(x, y, grid.zone),
    cellAt: ([lon, lat]) => cellAt(grid, lon, lat),
    inside: (point) => (outline ? pointInGeometry(point, outline) : true),
    temperatureAt: ([lon, lat]) => fieldAt(field, lon, lat),
    contributionsOf: (cell) => Object.fromEntries(keys.map((key) => [key, shap[key]?.[cell] ?? 0])),
  };
}

function openingTransect(field: Field, source: TransectSource): Transect {
  const toLonLat = (u: number, v: number): LonLat => slotToLonLat(field.grid, fineToSlot(field.factor, u), fineToSlot(field.factor, v));
  const radius = Math.round((HOT_PATCH_RADIUS_M / field.grid.cellSizeM) * field.factor);
  const hottest = hottestPatch(
    field.values,
    field.fx,
    field.fy,
    (u, v) => (field.coverage[v * field.fx + u] ?? 0) >= COVERED && source.inside(toLonLat(u, v)),
    radius,
  );
  const center = hottest ? toLonLat(hottest[0], hottest[1]) : toLonLat(field.fx / 2, field.fy / 2);
  return defaultTransect(source, center);
}

export function buildCityModel(detail: CityDetail, outline: Outline | null): CityModel {
  const { cells, grid: gridInfo, stats } = detail;
  const grid = buildCellGrid(cells.lon, cells.lat, gridInfo.cellSizeM);
  const field = buildField(grid, cells.lst);
  const levels = isothermLevels(stats.lstMean);
  const source = transectSource(detail, grid, field, outline);
  const hotspot = hotspotProfile(detail);
  const dominant = dominantFactorPerCell(detail);
  const inside = insideMask(cells.lon, cells.lat, outline);
  const island = outline ? heatIslandIntensity(cells.lst, inside) : null;
  const strength = dominant.map((key, i) => (key ? (cells.shap[key]?.[i] ?? 0) : 0));
  return {
    detail,
    outline,
    grid,
    field,
    levels,
    shares: classShares(levels, cells.lst),
    isotherms: isothermGeometry(field, levels),
    causeAreas: causeAreas(grid, dominant, strength),
    source,
    hotspot,
    facts: cityFacts(detail, inside, island),
    inside,
    island,
    cityMeans: cityFactorMeans(detail),
    defaultTransect: openingTransect(field, source),
  };
}
