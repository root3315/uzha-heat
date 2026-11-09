import type { FeatureMeta } from '../data/contract';
import type { PlaceProfile } from './places';

export interface WaterfallStep {
  key: string;
  label: string;
  start: number;
  end: number;
  delta: number;
}

export interface Waterfall {
  base: number;
  steps: WaterfallStep[];
  predicted: number;
  observed: number;
  residual: number;
}

export const OTHER_FACTORS_KEY = '__other';

/**
 * Walks from the model base value to the place's predicted temperature, factor by factor
 * (largest absolute contribution first). Small contributions are folded into one step.
 */
export function buildWaterfall(profile: PlaceProfile, features: FeatureMeta[], base: number, maxSteps = 6): Waterfall {
  const ranked = features
    .map((f) => ({ key: f.key, label: f.label, delta: profile.contributions[f.key] ?? 0 }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const shown = ranked.length > maxSteps ? ranked.slice(0, maxSteps - 1) : ranked;
  const folded = ranked.slice(shown.length);
  const rows = folded.length
    ? [...shown, { key: OTHER_FACTORS_KEY, label: `Прочие (${folded.length})`, delta: folded.reduce((s, r) => s + r.delta, 0) }]
    : shown;

  let running = base;
  const steps = rows.map((row) => {
    const start = running;
    running += row.delta;
    return { ...row, start, end: running };
  });

  return { base, steps, predicted: running, observed: profile.lst, residual: profile.lst - running };
}
