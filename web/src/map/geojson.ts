import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import type { CityDetail } from '../data/contract';
import { dominantFactorPerCell, dominantHeatingFactor } from '../domain/places';

export type CellProperties = Record<string, number | string>;

/**
 * The pipeline grid is square in a projected CRS, so in lon/lat its centres drift slightly off
 * a regular lattice. A small overlap hides the hairline seams this would leave between cells.
 */
const CELL_OVERLAP = 1.06;

export const shapProperty = (key: string): string => `s_${key}`;

/** Square-ish polygons around each cell centre (centre ± halfSizeDeg). */
export function cellsToGeoJson(detail: CityDetail): FeatureCollection<Polygon, CellProperties> {
  const { lon, lat, lst, shap } = detail.cells;
  const hx = detail.grid.halfSizeDeg[0] * CELL_OVERLAP;
  const hy = detail.grid.halfSizeDeg[1] * CELL_OVERLAP;
  const dominant = dominantFactorPerCell(detail);
  const keys = detail.features.map((f) => f.key);

  const features = lon.map((x, i): Feature<Polygon, CellProperties> => {
    const y = lat[i] ?? 0;
    const properties: CellProperties = { lst: lst[i] ?? 0, dom: dominant[i] ?? '' };
    for (const key of keys) properties[shapProperty(key)] = shap[key]?.[i] ?? 0;
    return {
      type: 'Feature',
      id: i,
      properties,
      geometry: {
        type: 'Polygon',
        coordinates: [[[x - hx, y - hy], [x + hx, y - hy], [x + hx, y + hy], [x - hx, y + hy], [x - hx, y - hy]]],
      },
    };
  });
  return { type: 'FeatureCollection', features };
}

export function districtsToGeoJson(detail: CityDetail): FeatureCollection<Polygon | MultiPolygon, CellProperties> {
  const keys = detail.features.map((f) => f.key);
  return {
    type: 'FeatureCollection',
    features: detail.districts.map((district, i) => {
      const properties: CellProperties = {
        name: district.name,
        lst: district.lstMean,
        dom: dominantHeatingFactor(keys, (key) => district.shapMean[key] ?? 0) ?? '',
      };
      for (const key of keys) properties[shapProperty(key)] = district.shapMean[key] ?? 0;
      return { type: 'Feature', id: i, properties, geometry: district.geometry };
    }),
  };
}
