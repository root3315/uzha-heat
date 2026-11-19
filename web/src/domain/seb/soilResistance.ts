/**
 * Bare-soil surface resistance, s m⁻¹, kept on its own: the parameterisation is expected to change, and a change here
 * must match `surface_resistance` in pipeline/uzha/seb/physics.py (the golden test catches a mismatch).
 *
 * r_ss = exp(8.206 − 4.255·θ/θ_sat), Sellers et al. (1992), J. Geophys. Res. 97(D17), 19033–19059,
 * https://doi.org/10.1029/92JD01096 (as tabulated by Tang & Riley 2013, HESS 17, 873–893, Table 1), times the
 * calibrated Params.soilResistanceScale.
 */
import type { Params } from './types';

const SELLERS_A = 8.206;
const SELLERS_B = 4.255;
/** Soil moisture at saturation, m³ m⁻³, "medium" texture of IFS Cy47r1 Part IV Table 8.9. */
export const THETA_SAT = 0.439;

export function bareSoilResistance(soilMoisture: number, params: Params): number {
  const relative = Math.min(Math.max(soilMoisture / THETA_SAT, 0.0), 1.0);
  return Math.exp(SELLERS_A - SELLERS_B * relative) * params.soilResistanceScale;
}
