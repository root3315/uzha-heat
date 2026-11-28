/**
 * Flux parameterisations of the per-tile surface energy balance for one cell (docs/theory.pdf, sections 3–8).
 * Port of pipeline/uzha/seb/physics.py: same constants, stability functions and guards, written per tile instead of
 * vectorised. The stated modelling assumptions and the literature behind each constant are in the Python module.
 *
 * `prepareCell` computes everything that does not depend on the surface temperature, one TileSetup per tile;
 * `tileFluxes` evaluates every term of F(T) = Rn + QF − H − LE − ΔQS (Eq. 5) for a trial temperature.
 */
import { bareSoilResistance } from './soilResistance';
import {
  CANYON_FLOOR,
  CP_AIR,
  IMPERVIOUS,
  KELVIN,
  LV,
  RD,
  SIGMA,
  TILE,
  TILES,
  VEGETATED,
  VON_KARMAN,
  type CellForcing,
  type CellInputs,
  type Params,
  type TileName,
} from './types';

const GRAVITY = 9.80665; // m s⁻²
const EPS_WATER = 0.622; // ratio of the gas constants of dry air and water vapour (Eq. 29)

// Saturation vapour pressure, kPa, T in °C (Eq. 27), Tetens form as in FAO-56.
const TETENS_E0 = 0.6108;
const TETENS_A = 17.27;
const TETENS_B = 237.3;

// Monin–Obukhov stability: Businger–Dyer/Paulson unstable, Beljaars–Holtslag (1991) stable.
const DYER_UNSTABLE = 16.0;
const BH_A = 1.0;
const BH_B = 2.0 / 3.0;
const BH_C = 5.0;
const BH_D = 0.35;
const ZETA_MIN = -10.0; // z/L floor in unstable air
const STABLE_ITERATIONS = 8; // Newton passes on ln ζ for Ri_b → ζ in stable air
const MO_ITERATIONS = 8; // fixed-point passes for the Obukhov length in unstable air
const MO_TOLERANCE = 0.02; // relative change of z/L on the last pass above which the iteration counts as failed

// Free-convection velocity (Beljaars 1995): |U|² = u² + w*², boundary-layer depth 1000 m.
const BL_DEPTH = 1000.0;
const MIN_WIND = 0.1; // m s⁻¹, numerical floor for calm, stable cases where w* = 0

/** kB⁻¹ = ln 10 for vegetation; other tiles take the calibrated Params.kbInv. */
const KB_INV_VEGETATION = Math.log(10.0);

// Jarvis–Stewart canopy resistance (Noilhan & Planton 1989; IFS Cy47r1 Part IV Eq. 8.9–8.14).
const VPD_COEF_TREE = 0.03 * 10.0; // kPa⁻¹
// Leaf area index per vegetation tile (IFS Cy47r1 Part IV Table 8.1): rs = rs_min/LAI·….
const LAI_TREE = 5.0;
const LAI_GRASS = 2.0;
const LAI_CROP = 3.0;
const THETA_CAP = 0.347;
const THETA_PWP = 0.151;
const F2_MIN = 1e-3;

const clip = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);
const inTiles = (names: readonly TileName[], k: number): boolean => names.includes(TILES[k] as TileName);

/** e_s(T), kPa (Eq. 27). */
export function saturationVapourPressure(tKelvin: number): number {
  const tC = tKelvin - KELVIN;
  return TETENS_E0 * Math.exp((TETENS_A * tC) / (tC + TETENS_B));
}

/** γ = cp·p/(ε·Lv), kPa K⁻¹. */
export function psychrometricConstant(pressureKpa: number): number {
  return (CP_AIR * pressureKpa) / (EPS_WATER * LV);
}

/** ρ = p / (Rd·Tv), kg m⁻³ (Eq. 24, Eq. 29). */
export function airDensity(pressureKpa: number, tAirK: number, eAirKpa: number): number {
  const tVirtual = tAirK / (1.0 - ((1.0 - EPS_WATER) * eAirKpa) / pressureKpa);
  return (pressureKpa * 1e3) / (RD * tVirtual);
}

/** (ψm, ψh, dψm/dζ, dψh/dζ) for ζ ≥ 0 (Beljaars & Holtslag 1991). */
function stablePsi(zeta: number): [number, number, number, number] {
  const decay = Math.exp(-BH_D * zeta);
  const tail = BH_B * (zeta - BH_C / BH_D) * decay + (BH_B * BH_C) / BH_D;
  const tailSlope = BH_B * decay * (1.0 + BH_C - BH_D * zeta);
  const root = Math.sqrt(1.0 + (2.0 * BH_A * zeta) / 3.0);
  return [-(BH_A * zeta + tail), -(root ** 3 + tail - 1.0), -(BH_A + tailSlope), -(BH_A * root + tailSlope)];
}

/** Integrated stability function for momentum (Paulson 1970 unstable, Beljaars & Holtslag 1991 stable). */
export function psiM(zeta: number): number {
  if (zeta < 0.0) {
    const x = Math.sqrt(Math.sqrt(1.0 - DYER_UNSTABLE * zeta));
    return 2.0 * Math.log((1.0 + x) / 2.0) + Math.log((1.0 + x * x) / 2.0) - 2.0 * Math.atan(x) + Math.PI / 2.0;
  }
  return stablePsi(Math.max(zeta, 0.0))[0];
}

/** Integrated stability function for heat and water vapour. */
export function psiH(zeta: number): number {
  if (zeta < 0.0) return 2.0 * Math.log((1.0 + Math.sqrt(1.0 - DYER_UNSTABLE * zeta)) / 2.0);
  return stablePsi(Math.max(zeta, 0.0))[1];
}

/** ra = ln(z/z0m)·ln(z/z0h) / (k²·u), s m⁻¹ (Eq. 23). */
export function neutralResistance(z: number, z0m: number, z0h: number, wind: number): number {
  return (Math.log(z / z0m) * Math.log(z / z0h)) / (VON_KARMAN ** 2 * wind);
}

/**
 * z/L in stable air from the bulk Richardson number: solves ζ·Lh(ζ)/Lm(ζ)² = Ri_b by Newton steps on ln ζ from the
 * first-order guess ζ ≈ Ri_b·Lm(0)²/Lh(0).
 */
export function stableZeta(bulkRichardson: number, z: number, z0m: number, z0h: number): number {
  const ri = Math.max(bulkRichardson, 1e-12);
  const logM = Math.log(z / z0m);
  const logH = Math.log(z / z0h);
  const rm = z0m / z;
  const rh = z0h / z;
  let logZeta = Math.log((ri * logM ** 2) / logH);
  for (let pass = 0; pass < STABLE_ITERATIONS; pass++) {
    const zeta = Math.exp(logZeta);
    const [pm, ph, dpm, dph] = stablePsi(zeta);
    const [pm0, , dpm0] = stablePsi(zeta * rm);
    const [, ph0, , dph0] = stablePsi(zeta * rh);
    const integralM = logM - pm + pm0;
    const integralH = logH - ph + ph0;
    const mismatch = logZeta + Math.log(integralH) - 2.0 * Math.log(integralM) - Math.log(ri);
    const slope = 1.0 + zeta * ((-dph + rh * dph0) / integralH - (2.0 * (-dpm + rm * dpm0)) / integralM);
    logZeta = logZeta - clip(mismatch / Math.max(slope, 0.1), -2.0, 2.0);
  }
  return bulkRichardson > 0.0 ? Math.exp(logZeta) : 0.0;
}

/** Paulson's (ψm, ψh) from x = (1 − 16ζ)^(1/4), as in the unstable loop of the Python solver. */
function unstablePsiPair(x: number): [number, number] {
  const logX2 = Math.log((1.0 + x * x) / 2.0);
  return [2.0 * Math.log((1.0 + x) / 2.0) + logX2 - 2.0 * Math.atan(x) + Math.PI / 2.0, 2.0 * logX2];
}

const xOf = (zeta: number): number => Math.sqrt(Math.sqrt(1.0 - DYER_UNSTABLE * zeta));

interface UnstableResult {
  zeta: number;
  speed: number;
  unsettled: boolean;
}

/**
 * Fixed-point iteration for z/L and the free-convection wind on a surface warmer than the air, a fixed number of
 * passes so ra(T) stays a smooth function of the surface temperature.
 */
function unstable(excess: number, tAir: number, calm: number, z: number, z0m: number, z0h: number): UnstableResult {
  const logM = Math.log(z / z0m);
  const logH = Math.log(z / z0h);
  const z0mOverZ = z0m / z;
  const z0hOverZ = z0h / z;
  let zeta = Math.max(((((-GRAVITY * z * excess) / (tAir * calm * calm)) * logM * logM) / logH), ZETA_MIN);
  let speed = calm;
  let step = 0.0;
  for (let pass = 0; pass < MO_ITERATIONS; pass++) {
    const [psiMz, psiHz] = unstablePsiPair(xOf(zeta));
    const [psiM0] = unstablePsiPair(xOf(zeta * z0mOverZ));
    const [, psiH0] = unstablePsiPair(xOf(zeta * z0hOverZ));
    const integralM = logM - psiMz + psiM0;
    const integralH = logH - psiHz + psiH0;
    const uStar = (VON_KARMAN * speed) / integralM;
    const heat = (excess * VON_KARMAN * uStar) / integralH; // H/(ρ cp), K m s⁻¹
    speed = Math.sqrt(calm * calm + Math.cbrt((GRAVITY / tAir) * heat * BL_DEPTH) ** 2);
    const target = Math.max((-VON_KARMAN * GRAVITY * z * heat) / (uStar ** 3 * tAir), ZETA_MIN);
    step = target - zeta;
    zeta = target;
  }
  return { zeta, speed, unsettled: Math.abs(step) > MO_TOLERANCE * Math.max(1.0, Math.abs(zeta)) };
}

export interface Resistance {
  ra: number;
  /** The unstable iteration did not settle (or ra was not usable) and the neutral resistance was used. */
  fallback: boolean;
}

/** ra with Monin–Obukhov stability and the free-convection wind (Eq. 22–24 with ψ corrections). */
export function aerodynamicResistance(
  tSurface: number,
  tAir: number,
  wind: number,
  z: number,
  z0m: number,
  z0h: number,
): Resistance {
  const calm = Math.max(wind, MIN_WIND);
  const excess = tSurface - tAir;
  let zeta = 0.0;
  let speed = calm;
  let fallback = false;
  if (excess < 0.0) {
    const richardson = (GRAVITY * z * -excess) / (tAir * calm ** 2);
    zeta = stableZeta(richardson, z, z0m, z0h);
  } else if (excess > 0.0) {
    ({ zeta, speed, unsettled: fallback } = unstable(excess, tAir, calm, z, z0m, z0h));
  }
  const integralM = Math.log(z / z0m) - psiM(zeta) + psiM((zeta * z0m) / z);
  const integralH = Math.log(z / z0h) - psiH(zeta) + psiH((zeta * z0h) / z);
  const ra = (integralM * integralH) / (VON_KARMAN ** 2 * speed);
  fallback = fallback || !Number.isFinite(ra) || ra <= 0.0;
  return { ra: fallback ? neutralResistance(z, z0m, z0h, speed) : ra, fallback };
}

/** Everything temperature-independent for one tile. */
export interface TileSetup {
  tAir: number;
  eAir: number;
  emissivity: number;
  /** (1 − α)·K↓_tile. */
  shortwaveAbsorbed: number;
  /** ε·L↓_tile. */
  longwaveIn: number;
  rhoCp: number;
  /** γ, kPa K⁻¹. */
  psy: number;
  wind: number;
  /** zRef − zd. */
  z: number;
  z0m: number;
  z0h: number;
  /** Surface resistance, s m⁻¹; Infinity where there is no evaporation. */
  rs: number;
  a1: number;
  /** a2·dRn/dt + a3. */
  storageOffset: number;
  qf: number;
}

/** K↓_tile / K↓: the sunlit part gets everything, the shaded part only the diffuse light (Eq. 30). */
function shortwaveShare(shade: number, diffuseFraction: number): number {
  return 1.0 - clip(shade, 0.0, 1.0) * (1.0 - clip(diffuseFraction, 0.0, 1.0));
}

/** L↓ per tile: open sky for roofs, trees and water; sky plus walls at air temperature on the canyon floor. */
function longwaveDownTile(k: number, skyView: number, lDown: number, tAir: number): number {
  if (!inTiles(CANYON_FLOOR, k)) return lDown;
  const svf = clip(skyView, 0.0, 1.0);
  return svf * lDown + (1.0 - svf) * SIGMA * tAir ** 4;
}

/** rs per tile, s m⁻¹ (theory section 5.3): Infinity on impervious tiles (LE = 0), 0 on water. */
export function surfaceResistances(inputs: CellInputs, forcing: CellForcing, params: Params, tAir: number): number[] {
  const vpd = Math.max(saturationVapourPressure(tAir) - forcing.eAir, 0.0);
  const theta = inputs.soilMoisture;
  const f2 = inputs.irrigated ? 1.0 : clip((theta - THETA_PWP) / (THETA_CAP - THETA_PWP), F2_MIN, 1.0);
  const rs = TILES.map(() => Infinity);
  rs[TILE.tree] = ((params.rsMinTree / LAI_TREE) * Math.exp(VPD_COEF_TREE * vpd)) / f2;
  rs[TILE.grass] = (inputs.rural ? params.rsMinCrop / LAI_CROP : params.rsMinGrass / LAI_GRASS) / f2;
  rs[TILE.bare] = bareSoilResistance(theta, params);
  rs[TILE.water] = 0.0;
  return rs;
}

/**
 * QF per tile: all of it on the impervious tiles in proportion to their area, so the cell mean is inputs.qf.
 * A cell without impervious surface gets it on every tile evenly.
 */
export function anthropogenicHeat(inputs: CellInputs): number[] {
  let share = 0.0;
  for (let k = 0; k < TILES.length; k++) if (inTiles(IMPERVIOUS, k)) share += inputs.fraction[k] ?? 0;
  if (!(share > 0)) return TILES.map(() => inputs.qf);
  return TILES.map((_, k) => (inTiles(IMPERVIOUS, k) ? inputs.qf / share : 0.0));
}

export function prepareCell(inputs: CellInputs, forcing: CellForcing, params: Params): TileSetup[] {
  let sealed = 0.0;
  for (let k = 0; k < TILES.length; k++) if (inTiles(IMPERVIOUS, k)) sealed += inputs.fraction[k] ?? 0;
  const tAir = forcing.tAir + params.dTAir + params.dTAirUrban * sealed;
  const z0m = Math.max(inputs.z0m, 1e-4);
  // The reference height must clear the roughness: at least 5·z0m above the displacement height.
  const z = Math.max(forcing.zRef - inputs.zd, 5.0 * z0m);
  const rhoCp = airDensity(forcing.pressure, tAir, forcing.eAir) * CP_AIR;
  const psy = psychrometricConstant(forcing.pressure);
  const rs = surfaceResistances(inputs, forcing, params, tAir);
  const qf = anthropogenicHeat(inputs);
  return TILES.map((_, k) => {
    const albedo = inputs.albedo[k] ?? 0;
    const emissivity = inputs.emissivity[k] ?? 0;
    const [a1, a2, a3] = inputs.ohm[k] ?? [0, 0, 0];
    const share = shortwaveShare(inputs.shade[k] ?? 0, forcing.diffuseFraction);
    const kbInv = inTiles(VEGETATED, k) ? KB_INV_VEGETATION : params.kbInv;
    const dRnDt = (1.0 - albedo) * share * forcing.dkDt; // W m⁻² h⁻¹
    return {
      tAir,
      eAir: forcing.eAir,
      emissivity,
      shortwaveAbsorbed: (1.0 - albedo) * share * forcing.kDown,
      longwaveIn: emissivity * longwaveDownTile(k, inputs.skyView, forcing.lDown, tAir),
      rhoCp,
      psy,
      wind: forcing.wind,
      z,
      z0m,
      z0h: z0m * Math.exp(-kbInv),
      rs: rs[k] ?? Infinity,
      a1: a1 * (inTiles(IMPERVIOUS, k) ? params.ohmA1Scale : 1.0),
      storageOffset: a2 * dRnDt + a3,
      qf: qf[k] ?? 0,
    };
  });
}

export interface TileFluxes {
  rn: number;
  h: number;
  le: number;
  dqs: number;
  qf: number;
  /** F = Rn + QF − H − LE − ΔQS, W m⁻². */
  residual: number;
  fallback: boolean;
}

/** Every term of Eq. 5 at the trial temperature. */
export function tileFluxes(setup: TileSetup, tSurface: number): TileFluxes {
  const rn = setup.shortwaveAbsorbed + setup.longwaveIn - setup.emissivity * SIGMA * tSurface ** 4;
  const { ra, fallback } = aerodynamicResistance(tSurface, setup.tAir, setup.wind, setup.z, setup.z0m, setup.z0h);
  const conductance = 1.0 / ra;
  const h = setup.rhoCp * (tSurface - setup.tAir) * conductance;
  const deficit = saturationVapourPressure(tSurface) - setup.eAir;
  // LE = (ρ cp/γ)·(e_s(T) − e_a)/(ra + rs), with conductances so rs = Infinity gives exactly 0.
  const leConductance = 1.0 / (1.0 / conductance + setup.rs);
  const le = (setup.rhoCp / setup.psy) * deficit * leConductance;
  const dqs = setup.a1 * rn + setup.storageOffset;
  const residual = rn + setup.qf - h - le - dqs;
  return { rn, h, le, dqs, qf: setup.qf, residual, fallback };
}

/** Only the residual F(T), for the root finder. */
export function residualAt(setup: TileSetup, tSurface: number): number {
  return tileFluxes(setup, tSurface).residual;
}
