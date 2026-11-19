/**
 * Root finder for the per-tile surface energy balance F_k(T_k) = 0 of one cell (docs/theory.pdf, Eq. 5–6).
 * Port of pipeline/uzha/seb/solve.py, element by element: a bracketed secant method on [Ta − 15 K, Ta + 45 K] that
 * bisects whenever the step would leave the bracket or |F| did not halve. A tile counts as converged when
 * |F| < 0.1 W m⁻² (it is driven to 1e-4). A tile whose residual does not change sign over the bracket is returned at
 * the bracket end with the smaller |F| and marked as not converged (theory section 2.1).
 */
import { prepareCell, residualAt, tileFluxes, type TileSetup } from './physics';
import { SIGMA, type CellForcing, type CellInputs, type CellState, type Params, type PerTile } from './types';

const BRACKET_BELOW = 15.0; // K under the air temperature
const BRACKET_ABOVE = 45.0; // K over it
const TOLERANCE = 1e-4; // W m⁻², |F| at which a tile is done
const CLOSURE = 0.1; // W m⁻², |F| up to which a tile counts as converged
const MAX_ITERATIONS = 60;
const BRACKET_FLOOR = 1e-9; // K, a bracket this narrow cannot be refined further

/** Safeguarded secant on a bracket with F(lower) ≥ 0 ≥ F(upper), falling back to bisection. */
function iterate(setup: TileSetup, lower: number, upper: number, fLower: number, fUpper: number): number {
  let t = fLower > fUpper ? lower + (fLower * (upper - lower)) / (fLower - fUpper) : lower;
  t = Math.min(Math.max(t, lower), upper);
  let lo = lower;
  let hi = upper;
  let tPrev = upper;
  let fPrev = fUpper;
  for (let pass = 0; pass < MAX_ITERATIONS; pass++) {
    const f = residualAt(setup, t);
    if (!(Math.abs(f) >= TOLERANCE && hi - lo > BRACKET_FLOOR)) break;
    if (f > 0.0) lo = t;
    else hi = t;
    const slope = (f - fPrev) / (t - tPrev);
    const secant = t - f / slope;
    // Bisect when the secant would leave the bracket or the last step did not halve |F|.
    const inside = slope < 0.0 && secant > lo && secant < hi && Math.abs(f) < 0.5 * Math.abs(fPrev);
    tPrev = t;
    fPrev = f;
    t = inside ? secant : 0.5 * (lo + hi);
  }
  return t;
}

interface TileRoot {
  t: number;
  bracketed: boolean;
}

function solveTile(setup: TileSetup): TileRoot {
  const lower = setup.tAir - BRACKET_BELOW;
  const upper = setup.tAir + BRACKET_ABOVE;
  const fLower = residualAt(setup, lower);
  const fUpper = residualAt(setup, upper);
  const bracketed = fLower >= 0.0 && fUpper <= 0.0;
  if (!bracketed) return { t: Math.abs(fLower) < Math.abs(fUpper) ? lower : upper, bracketed };
  return { t: iterate(setup, lower, upper, fLower, fUpper), bracketed };
}

/** Radiance-weighted cell temperature (Σ f ε T⁴ / Σ f ε)^(1/4) over the tiles present (theory section 10), K. */
export function cellTemperature(fraction: PerTile, emissivity: PerTile, tSurface: PerTile): number {
  let radiance = 0.0;
  let weights = 0.0;
  for (let k = 0; k < fraction.length; k++) {
    const share = fraction[k] ?? 0;
    const weight = share > 0.0 ? share * (emissivity[k] ?? 0) : 0.0;
    radiance += weight * SIGMA * (tSurface[k] ?? 0) ** 4;
    weights += weight;
  }
  return (radiance / weights / SIGMA) ** 0.25;
}

/** Equilibrium temperature and fluxes of every tile of the cell, plus the cell's radiance-weighted temperature. */
export function solveCell(inputs: CellInputs, forcing: CellForcing, params: Params): CellState {
  const state: CellState = {
    tSurface: [],
    rn: [],
    h: [],
    le: [],
    dqs: [],
    qf: [],
    residual: [],
    converged: [],
    stabilityFallback: [],
    tCell: NaN,
  };
  for (const setup of prepareCell(inputs, forcing, params)) {
    const { t, bracketed } = solveTile(setup);
    const flux = tileFluxes(setup, t);
    state.tSurface.push(t);
    state.rn.push(flux.rn);
    state.h.push(flux.h);
    state.le.push(flux.le);
    state.dqs.push(flux.dqs);
    state.qf.push(flux.qf);
    state.residual.push(flux.residual);
    state.converged.push(bracketed && Math.abs(flux.residual) < CLOSURE);
    state.stabilityFallback.push(flux.fallback);
  }
  state.tCell = cellTemperature(inputs.fraction, inputs.emissivity, state.tSurface);
  return state;
}
