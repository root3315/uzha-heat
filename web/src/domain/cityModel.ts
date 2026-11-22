import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { CityDetail } from '../data/contract';
import { cityFacts, type CityFacts } from './answers';
import { causeAreas, type CauseAreaProperties } from './causeAreas';
import { heatIslandIntensity, insideMask, type HeatIsland } from './heatIsland';
import { buildField, fieldAt, fineToSlot, type Field } from './field';
import { buildCellGrid, cellAt, slotToLonLat, type CellGrid } from './grid';
import { classShares, isothermGeometry, isothermLevels, type IsothermGeometry, type IsothermLevels } from './isotherms';
import { hotPlacesByPeople } from './people';
import { cityFactorMeans, dominantFactorPerCell, hotspotProfile, type FactorMeans, type PlaceProfile } from './places';
import { pointInGeometry, quantile } from './stats';
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
  /**
   * Where the 3D view flies to: the hot cell where most people live (crowded places are the ones drawn in OSM),
   * else the hottest built-up cell, else the hottest neighbourhood.
   */
  threeDCenter: LonLat;
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

/**
 * The heavy, data-only half of the model: the surface, its contours, the cause areas and where the
 * opening section goes. Plain data with typed arrays, so it can be computed in a worker and posted back.
 */
export interface CitySurface {
  grid: CellGrid;
  field: Field;
  levels: IsothermLevels;
  shares: number[];
  isotherms: IsothermGeometry;
  causeAreas: FeatureCollection<MultiPolygon, CauseAreaProperties>;
  inside: boolean[];
  island: HeatIsland | null;
  /** Centre of the hottest lived-in neighbourhood inside the city, where the opening section is laid. */
  hotCenter: LonLat;
}

/**
 * Cells where people live: at least as crowded as the median cell inside the city (WorldPop).
 * Runways, aprons and rail yards come out nearly empty, so the opening section goes through a neighbourhood, not an airfield.
 * Every cell counts when population is unknown.
 */
function livedIn(detail: CityDetail, inside: readonly boolean[]): (cell: number) => boolean {
  const pop = detail.cells.pop;
  if (!pop) return () => true;
  const median = quantile(pop.filter((_, i) => inside[i]), 0.5);
  return (cell) => cell >= 0 && (pop[cell] ?? 0) >= median;
}

function hotCenter(field: Field, outline: Outline | null, grid: CellGrid, lived: (cell: number) => boolean): LonLat {
  const toLonLat = (u: number, v: number): LonLat => slotToLonLat(field.grid, fineToSlot(field.factor, u), fineToSlot(field.factor, v));
  const radius = Math.round((HOT_PATCH_RADIUS_M / field.grid.cellSizeM) * field.factor);
  // A pixel lies in up to (2 · radius / step + 1)² neighbourhoods, and each look costs two UTM projections:
  // decide once per pixel whether people live there (0 not yet asked, 1 yes, −1 no).
  const livedKnown = new Int8Array(field.fx * field.fy);
  const livedAt = (u: number, v: number): boolean => {
    const pixel = v * field.fx + u;
    let known = livedKnown[pixel] ?? 0;
    if (known === 0) {
      const [lon, lat] = toLonLat(u, v);
      known = lived(cellAt(grid, lon, lat)) ? 1 : -1;
      livedKnown[pixel] = known;
    }
    return known > 0;
  };
  const allowed = (u: number, v: number): boolean =>
    (field.coverage[v * field.fx + u] ?? 0) >= COVERED && (!outline || pointInGeometry(toLonLat(u, v), outline)) && livedAt(u, v);
  const hottest = hottestPatch(field.values, field.fx, field.fy, allowed, radius, { counted: livedAt, minShare: 0.5 });
  return hottest ? toLonLat(hottest[0], hottest[1]) : toLonLat(field.fx / 2, field.fy / 2);
}

export function citySurface(detail: CityDetail, outline: Outline | null): CitySurface {
  const { cells, grid: gridInfo, stats } = detail;
  const grid = buildCellGrid(cells.lon, cells.lat, gridInfo.cellSizeM);
  const field = buildField(grid, cells.lst);
  const levels = isothermLevels(stats.lstMean);
  const dominant = dominantFactorPerCell(detail);
  const strength = dominant.map((key, i) => (key ? (cells.shap[key]?.[i] ?? 0) : 0));
  const inside = insideMask(cells.lon, cells.lat, outline);
  return {
    grid,
    field,
    levels,
    shares: classShares(levels, cells.lst),
    isotherms: isothermGeometry(field, levels),
    causeAreas: causeAreas(grid, dominant, strength),
    inside,
    island: outline ? heatIslandIntensity(cells.lst, inside) : null,
    hotCenter: hotCenter(field, outline, grid, livedIn(detail, inside)),
  };
}

/** The light half: what needs the parsed data and functions over the surface. Cheap enough for the main thread. */
/** A cell at least this built up (%, ESA WorldCover) counts as a neighbourhood with buildings. */
const BUILT_UP_PERCENT = 40;
/** And, where population is known, at least this crowded among the city's cells: crowded places are drawn in OSM. */
const CROWDED_QUANTILE = 0.75;

/**
 * Where the 3D view flies: the hottest cell inside the outline that is built up, crowded (when population is known) and
 * that the map can colour (`onMap`: the smoothed surface covers it). Null when there is no such cell.
 */
export function builtHotCenter(detail: CityDetail, inside: readonly boolean[], onMap: (point: LonLat) => boolean = () => true): LonLat | null {
  const { lst, lon, lat, values, pop } = detail.cells;
  const built = values.built;
  if (!built) return null;
  const crowded = pop ? quantile(pop.filter((_, i) => inside[i]), CROWDED_QUANTILE) : 0;
  let best = -1;
  lst.forEach((t, i) => {
    if (!inside[i] || (built[i] ?? 0) < BUILT_UP_PERCENT || (pop && (pop[i] ?? 0) < crowded)) return;
    if (best >= 0 && t <= (lst[best] ?? -Infinity)) return;
    if (onMap([lon[i] ?? 0, lat[i] ?? 0])) best = i;
  });
  return best < 0 ? null : [lon[best] ?? 0, lat[best] ?? 0];
}

function threeDCenter(detail: CityDetail, inside: readonly boolean[], onMap: (point: LonLat) => boolean): LonLat | null {
  const crowded = hotPlacesByPeople(detail, inside, 1)[0]?.point;
  return crowded && onMap(crowded) ? crowded : builtHotCenter(detail, inside, onMap);
}

export function assembleCityModel(detail: CityDetail, outline: Outline | null, surface: CitySurface): CityModel {
  const { grid, field, levels, shares, isotherms, causeAreas: areas, inside, island } = surface;
  const source = transectSource(detail, grid, field, outline);
  return {
    detail,
    outline,
    grid,
    field,
    levels,
    shares,
    isotherms,
    causeAreas: areas,
    source,
    hotspot: hotspotProfile(detail),
    facts: cityFacts(detail, inside, island),
    inside,
    island,
    cityMeans: cityFactorMeans(detail),
    defaultTransect: defaultTransect(source, surface.hotCenter),
    threeDCenter: threeDCenter(detail, inside, (point) => Number.isFinite(source.temperatureAt(point))) ?? surface.hotCenter,
  };
}

export function buildCityModel(detail: CityDetail, outline: Outline | null): CityModel {
  return assembleCityModel(detail, outline, citySurface(detail, outline));
}
