import type { ExpressionSpecification } from 'maplibre-gl';
import type { CityDetail } from '../data/contract';
import {
  DIVERGING_RAMP,
  HEAT_RAMP,
  NO_HEATING_COLOR,
  divergingDomain,
  factorColor,
  heatDomain,
  rampToStops,
  type ColorStops,
} from '../domain/colorScales';
import { shapProperty } from './geojson';

export type MapMode = { kind: 'lst' } | { kind: 'dominant' } | { kind: 'shap'; key: string };
export type Granularity = 'cells' | 'districts';

export interface MapScales {
  heat: ColorStops;
  /** Symmetric half-range of each factor's contribution, °C. */
  shapRange: Record<string, number>;
  factorColors: Record<string, string>;
}

export function buildScales(detail: CityDetail): MapScales {
  const [lo, hi] = heatDomain(detail.cells.lst);
  return {
    heat: rampToStops(HEAT_RAMP, lo, hi),
    shapRange: Object.fromEntries(detail.features.map((f) => [f.key, divergingDomain(detail.cells.shap[f.key] ?? [])])),
    factorColors: Object.fromEntries(detail.features.map((f, i) => [f.key, factorColor(f.key, i)])),
  };
}

function interpolate(property: string, stops: ColorStops): ExpressionSpecification {
  return ['interpolate', ['linear'], ['get', property], ...stops.flat()] as ExpressionSpecification;
}

export function fillColorExpression(mode: MapMode, scales: MapScales): ExpressionSpecification | string {
  if (mode.kind === 'lst') return interpolate('lst', scales.heat);
  if (mode.kind === 'shap') {
    const range = scales.shapRange[mode.key] ?? 1;
    return interpolate(shapProperty(mode.key), rampToStops(DIVERGING_RAMP, -range, range));
  }
  const [first, ...others] = Object.entries(scales.factorColors);
  if (!first) return NO_HEATING_COLOR;
  return ['match', ['get', 'dom'], first[0], first[1], ...others.flat(), NO_HEATING_COLOR];
}
