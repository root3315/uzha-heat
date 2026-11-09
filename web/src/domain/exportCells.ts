import type { CityDetail } from '../data/contract';

/** Decimal places kept per kind of column: enough for the data, short enough to open in a spreadsheet. */
const DIGITS = { coordinate: 6, lst: 2, value: 4, shap: 3 } as const;

const round = (value: number | undefined, digits: number): number | null =>
  value === undefined || !Number.isFinite(value) ? null : Number(value.toFixed(digits));

export interface ExportRow {
  lon: number | null;
  lat: number | null;
  lst: number | null;
  inside: boolean;
  [column: string]: number | boolean | null;
}

/** One row per cell: position, surface temperature, inside the outline, each factor's value and its SHAP, °C. */
export function exportRows(detail: CityDetail, inside: readonly boolean[]): ExportRow[] {
  const { cells, features } = detail;
  return cells.lst.map((t, i) => {
    const row: ExportRow = {
      lon: round(cells.lon[i], DIGITS.coordinate),
      lat: round(cells.lat[i], DIGITS.coordinate),
      lst: round(t, DIGITS.lst),
      inside: inside[i] ?? true,
    };
    for (const { key } of features) row[key] = round(cells.values[key]?.[i], DIGITS.value);
    for (const { key } of features) row[`shap_${key}`] = round(cells.shap[key]?.[i], DIGITS.shap);
    return row;
  });
}

function columns(detail: CityDetail): string[] {
  const keys = detail.features.map((f) => f.key);
  return ['lon', 'lat', 'lst', 'inside', ...keys, ...keys.map((key) => `shap_${key}`)];
}

/** CSV with a header row, comma separated, decimal point, empty cell for a missing value. */
export function cellsToCsv(detail: CityDetail, inside: readonly boolean[]): string {
  const header = columns(detail);
  const lines = exportRows(detail, inside).map((row) =>
    header.map((column) => {
      const value = row[column];
      if (value === null || value === undefined) return '';
      return typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
    }).join(','),
  );
  return [header.join(','), ...lines].join('\n') + '\n';
}

/** A GeoJSON FeatureCollection of cell centres, every column as a property. */
export function cellsToGeoJson(detail: CityDetail, inside: readonly boolean[]): string {
  const features = exportRows(detail, inside).map(({ lon, lat, ...properties }) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties,
  }));
  return JSON.stringify({ type: 'FeatureCollection', features });
}
