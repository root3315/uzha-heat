/**
 * Physics "what if" for one cell: the interventions of pipeline/uzha/seb/scenarios.py as pure transforms of
 * CellInputs, and their evaluation with the same weather and parameters (Eq. 54–56). Tile fractions still sum to 1.
 * The assumptions behind each transform are listed next to its Python counterpart.
 */
import { solveCell } from './solve';
import { KELVIN, TILE, type CellForcing, type CellInputs, type Params, type TileName } from './types';

/** An intervention: the cell's inputs with the change applied. */
export type CellChange = (inputs: CellInputs) => CellInputs;

/** Reflective roofs: roof albedo set to `albedo` (0.55 is an aged white coating). Cells without roofs are unchanged. */
export function coolRoofs(inputs: CellInputs, albedo = 0.55, emissivity?: number): CellInputs {
  const roof = TILE.roof;
  if (!((inputs.fraction[roof] ?? 0) > 0)) return inputs;
  return {
    ...inputs,
    albedo: inputs.albedo.map((value, k) => (k === roof ? albedo : value)),
    emissivity:
      emissivity === undefined ? inputs.emissivity : inputs.emissivity.map((value, k) => (k === roof ? emissivity : value)),
  };
}

/** Reflective pavements: albedo of the present `tiles` (default road; add "paved" for squares) set to `albedo`. */
export function coolPavements(
  inputs: CellInputs,
  albedo = 0.3,
  emissivity?: number,
  tiles: readonly TileName[] = ['road'],
): CellInputs {
  const treated = new Set(tiles.map((tile) => TILE[tile]).filter((k) => (inputs.fraction[k] ?? 0) > 0));
  if (treated.size === 0) return inputs;
  return {
    ...inputs,
    albedo: inputs.albedo.map((value, k) => (treated.has(k) ? albedo : value)),
    emissivity:
      emissivity === undefined
        ? inputs.emissivity
        : inputs.emissivity.map((value, k) => (treated.has(k) ? emissivity : value)),
  };
}

export interface GreenRoofOptions {
  /** The cell's vegetation is watered (default true). */
  irrigated?: boolean;
  /** Substrate moisture, m³ m⁻³, applied to the whole cell (the solver has one soil moisture per cell). */
  soilMoisture?: number;
}

/**
 * Green roofs: `share` of the roof area joins the grass tile (the cell's grass albedo, emissivity, storage and
 * resistance), keeping the shade the roof had.
 */
export function greenRoofs(inputs: CellInputs, share = 1.0, options: GreenRoofOptions = {}): CellInputs {
  const { irrigated = true, soilMoisture } = options;
  const roof = TILE.roof;
  const grass = TILE.grass;
  const roofShare = inputs.fraction[roof] ?? 0;
  if (!(roofShare > 0)) return inputs;
  const amount = share * roofShare;
  const fraction = [...inputs.fraction];
  const shade = [...inputs.shade];
  // The grass tile's shade becomes the area-weighted mix of what it had and what the moved roof had.
  const newGrass = (fraction[grass] ?? 0) + amount;
  if (amount > 0) shade[grass] = ((fraction[grass] ?? 0) * (shade[grass] ?? 0) + amount * (shade[roof] ?? 0)) / newGrass;
  fraction[grass] = newGrass;
  fraction[roof] = Math.max(roofShare - amount, 0.0);
  return {
    ...inputs,
    fraction,
    shade,
    irrigated: irrigated || inputs.irrigated,
    soilMoisture: soilMoisture ?? inputs.soilMoisture,
  };
}

export interface CellWhatIf {
  /** Cell temperature as it is, °C. */
  before: number;
  /** Cell temperature with the change, °C. */
  after: number;
  /** after − before, K (= °C difference). */
  delta: number;
}

/** Solve the cell before and after the change with the same weather and parameters. */
export function whatIfCell(inputs: CellInputs, forcing: CellForcing, params: Params, change: CellChange): CellWhatIf {
  const before = solveCell(inputs, forcing, params).tCell - KELVIN;
  const after = solveCell(change(inputs), forcing, params).tCell - KELVIN;
  return { before, after, delta: after - before };
}
