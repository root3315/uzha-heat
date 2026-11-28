/**
 * Types of the physics model for ONE cell: a surface energy balance solved per surface tile.
 * Port of pipeline/uzha/seb/types.py; equation numbers refer to docs/theory.pdf.
 *
 * Sign convention (theory section 1): Rn and QF positive into the surface; H and LE positive upward; ΔQS positive
 * when energy is stored. Each tile k solves F_k(T_k) = Rn + QF − H − LE − ΔQS = 0 (Eq. 5–6).
 * Per-tile arrays have one value per tile, in TILES order. Temperatures are in kelvin.
 */

/** The surface tiles a cell is split into (Eq. 48, mosaic approach). */
export const TILES = ['tree', 'grass', 'bare', 'roof', 'road', 'paved', 'water'] as const;
export type TileName = (typeof TILES)[number];
export const TILE_COUNT = TILES.length;
export const TILE: Readonly<Record<TileName, number>> = {
  tree: 0,
  grass: 1,
  bare: 2,
  roof: 3,
  road: 4,
  paved: 5,
  water: 6,
};
export const VEGETATED: readonly TileName[] = ['tree', 'grass'];
export const IMPERVIOUS: readonly TileName[] = ['roof', 'road', 'paved'];
/** Ground-level tiles that buildings can shade and that see the street canyon rather than the open sky. */
export const CANYON_FLOOR: readonly TileName[] = ['road', 'paved', 'grass', 'bare'];

export const SIGMA = 5.670374419e-8; // Stefan–Boltzmann, W m⁻² K⁻⁴
export const CP_AIR = 1005.0; // J kg⁻¹ K⁻¹
export const VON_KARMAN = 0.4;
export const LV = 2.45e6; // J kg⁻¹
export const RD = 287.05; // J kg⁻¹ K⁻¹
export const KELVIN = 273.15;

/** A value per tile, in TILES order. */
export type PerTile<T = number> = readonly T[];

/** The weather at the overpass for the cell. */
export interface CellForcing {
  /** Incoming shortwave on a horizontal surface, W m⁻² (Eq. 15). */
  kDown: number;
  /** K_diffuse / K_down, 0..1. */
  diffuseFraction: number;
  /** Incoming longwave, W m⁻² (Eq. 14). */
  lDown: number;
  /** Air temperature at the reference height, K, corrected for the cell's elevation (Eq. 47). */
  tAir: number;
  /** Vapour pressure of the air, kPa. */
  eAir: number;
  /** kPa. */
  pressure: number;
  /** Wind speed at zRef, m s⁻¹. */
  wind: number;
  /** Reference (blending) height for wind and air temperature, m. */
  zRef: number;
  /** Solar zenith angle, rad (Eq. 17). */
  zenith: number;
  /** dK_down/dt at the overpass, W m⁻² h⁻¹, for the OHM hysteresis term. */
  dkDt: number;
}

/** What the solver needs about the cell and its tiles. */
export interface CellInputs {
  /** Area share of each tile, sums to 1 (Eq. 48). */
  fraction: PerTile;
  /** Broadband albedo (Eq. 7–9). */
  albedo: PerTile;
  /** Eq. 10–11. */
  emissivity: PerTile;
  /** Share of the tile shaded from the direct beam, 0..1 (Eq. 30). */
  shade: PerTile;
  /** Sky-view factor of the canyon floor, 0..1 (Eq. 20); 1 in open land. */
  skyView: number;
  /** Roughness length for momentum, m. */
  z0m: number;
  /** Zero-plane displacement height, m. */
  zd: number;
  /** Volumetric water content of the top soil, m³ m⁻³ (Eq. 39). */
  soilMoisture: number;
  /** Vegetation here is watered (no soil-moisture stress). */
  irrigated: boolean;
  /** OHM coefficients [a1 (-), a2 (h), a3 (W m⁻²)] per tile, for ΔQS. */
  ohm: PerTile<readonly [number, number, number]>;
  /** Anthropogenic heat flux of the cell, W m⁻² (Eq. 44), spread over the impervious tiles. */
  qf: number;
  /** The cell belongs to the ring around the city (its grass is crop land). */
  rural: boolean;
}

/** The global parameters calibrated against Landsat LST. */
export interface Params {
  /** ln(z0m/z0h) for urban surfaces. */
  kbInv: number;
  /** Minimum stomatal resistance of a leaf, s m⁻¹ (divided by the tile's LAI). */
  rsMinTree: number;
  rsMinGrass: number;
  /** Irrigated crops of the ring. */
  rsMinCrop: number;
  /** Multiplies the bare-soil surface resistance. */
  soilResistanceScale: number;
  /** Multiplies a1 of the impervious tiles. */
  ohmA1Scale: number;
  /** Global offset of the air temperature, K. */
  dTAir: number;
  /** Extra air warming over sealed ground, K per unit impervious share. */
  dTAirUrban: number;
}

/** The literature priors, as Params() in Python. */
export const DEFAULT_PARAMS: Readonly<Params> = {
  kbInv: 6.0,
  rsMinTree: 100.0,
  rsMinGrass: 60.0,
  rsMinCrop: 60.0,
  soilResistanceScale: 1.0,
  ohmA1Scale: 1.0,
  dTAir: 0.0,
  dTAirUrban: 0.0,
};

/** The solution for one cell: each tile's equilibrium temperature (K) and its fluxes (W m⁻²). */
export interface CellState {
  tSurface: number[];
  rn: number[];
  h: number[];
  le: number[];
  dqs: number[];
  qf: number[];
  /** F_k at the returned T_k, W m⁻²: the energy-balance closure. */
  residual: number[];
  converged: boolean[];
  /** The Monin–Obukhov iteration did not settle at T_k and the neutral resistance was used. */
  stabilityFallback: boolean[];
  /** Radiance-weighted cell temperature, K. */
  tCell: number;
}
