import { useCallback } from 'react';
import type { NightGrid } from '../data/night';
import type { CityModel } from '../domain/cityModel';
import { formatWatts } from '../domain/energy';
import { formats } from '../domain/format';
import { cellReadout } from '../domain/hunt';
import { fluxAt, isFluxLayer, nightAt, type MapLayer } from '../domain/layers';
import type { LonLat } from '../domain/transect';
import { LAYER_TEXTS } from './layers.texts';
import { useLocale } from './locale';

/** The cell under a point of the map (−1 outside the city or the data) and the readout shown there, for the layer on the map. */
export function useReadout(model: CityModel, layer: MapLayer = 'lst', night: NightGrid | null = null) {
  const locale = useLocale();
  const cellUnder = useCallback(
    (point: LonLat) => {
      // Inside by the cell's centre, the same test the hunt counts its targets with, so a find is always one of them.
      const cell = model.source.cellAt(point);
      return cell >= 0 && model.inside[cell] ? cell : -1;
    },
    [model],
  );

  const describe = useCallback(
    (point: LonLat) => {
      const { formatDeg } = formats(locale);
      const said = LAYER_TEXTS[locale].readout;
      // The night is read anywhere MODIS has a pixel: the countryside around is half of what it shows.
      if (layer === 'night') {
        const t = night ? nightAt(night, point[0], point[1]) : Number.NaN;
        return Number.isNaN(t) ? null : `${formatDeg(t)} ${said.night}`;
      }
      const cell = cellUnder(point);
      if (cell < 0) return null;
      if (isFluxLayer(layer)) {
        const value = fluxAt(model.detail, layer, cell);
        return Number.isFinite(value) ? `${formatWatts(value, locale)} ${said[layer]}` : null;
      }
      const readout = cellReadout(model.detail, cell, locale);
      if (!readout) return null;
      return readout.cause ? `${formatDeg(readout.t)} · ${readout.cause}` : formatDeg(readout.t);
    },
    [cellUnder, model, locale, layer, night],
  );

  return { cellUnder, describe };
}
