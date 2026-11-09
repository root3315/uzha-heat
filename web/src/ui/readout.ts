import { useCallback } from 'react';
import type { CityModel } from '../domain/cityModel';
import { formatDeg } from '../domain/format';
import { cellReadout } from '../domain/hunt';
import type { LonLat } from '../domain/transect';

/** The cell under a point of the map (−1 outside the city or the data) and the readout shown there. */
export function useReadout(model: CityModel) {
  const cellUnder = useCallback(
    (point: LonLat) => {
      const cell = model.source.cellAt(point);
      return cell >= 0 && model.source.inside(point) ? cell : -1;
    },
    [model],
  );

  const describe = useCallback(
    (point: LonLat) => {
      const cell = cellUnder(point);
      const readout = cell >= 0 ? cellReadout(model.detail, cell) : null;
      if (!readout) return null;
      return readout.cause ? `${formatDeg(readout.t)} · ${readout.cause}` : formatDeg(readout.t);
    },
    [cellUnder, model],
  );

  return { cellUnder, describe };
}
