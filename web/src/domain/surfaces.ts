/**
 * "Surfaces (physics)" for one picked cell: its energy-balance inputs from `seb-<id>.json`, the three changes the
 * panel offers (roof albedo, road albedo, green roofs) and their effect by the physics model, solved in the browser
 * with the same weather and fitted parameters (app-spec 11, Eq. 54–56).
 *
 * Two numbers, as app-spec 11.2 asks: the change of the whole cell's surface temperature and the change on the
 * treated surfaces themselves (area-weighted over the patches that changed, as pipeline/uzha/seb/scenarios.py does).
 */
import { columnAt, type SebCity, type SebColumn } from '../data/seb';
import { coolPavements, coolRoofs, greenRoofs } from './seb/scenarios';
import { solveCell } from './seb/solve';
import { KELVIN, TILE, TILES, type CellForcing, type CellInputs, type CellState, type Params, type TileName } from './seb/types';

/** A reflective roof coating when new (aged white coatings are near 0.55). */
export const ROOF_ALBEDO_TARGET = 0.75;
/** Light concrete or a reflective road coating. */
export const ROAD_ALBEDO_TARGET = 0.4;
/** A tile share below this is too small to offer a change for. */
const MIN_SHARE = 0.005;

/**
 * Whether the block is worth offering before its inputs load: the city file's built-up share or road density of the
 * cell is above 0. Without either factor in the file it is offered, and the loaded inputs decide.
 */
export function mayHaveSurfaces(values: Readonly<Record<string, readonly number[]>>, cell: number): boolean {
  const built = values.built?.[cell];
  const roads = values.roads?.[cell];
  if (built === undefined && roads === undefined) return true;
  return (built ?? 0) > 0 || (roads ?? 0) > 0;
}

export interface SurfaceCell {
  inputs: CellInputs;
  forcing: CellForcing;
  params: Params;
}

/** The solver's inputs, weather and parameters for one cell; null when the file does not fit the solver or the cell. */
export function surfaceCell(seb: SebCity, cell: number): SurfaceCell | null {
  if (seb.tiles.join() !== TILES.join() || !Number.isInteger(cell) || cell < 0 || cell >= seb.cells) return null;
  const { tile, cell: columns, forcing } = seb;
  const at = (column: SebColumn) => columnAt(column, cell);
  const impervious = at(columns.imperviousAlbedo);
  const shade = at(columns.canyonShade);
  const inputs: CellInputs = {
    fraction: TILES.map((name) => at(columns.fraction[name] ?? 0)),
    albedo: TILES.map((name) => (tile.imperviousTiles.includes(name) ? impervious : (tile.albedo[name] ?? Number.NaN))),
    emissivity: tile.emissivity,
    shade: TILES.map((name) => (tile.canyonTiles.includes(name) ? shade : 0)),
    skyView: at(columns.skyView),
    z0m: at(columns.z0m),
    zd: at(columns.zd),
    soilMoisture: at(columns.soilMoisture),
    irrigated: at(columns.irrigated) > 0.5,
    ohm: tile.ohm,
    qf: at(columns.qf),
    rural: at(columns.rural) > 0.5,
  };
  const weather: CellForcing = {
    kDown: forcing.kDown,
    diffuseFraction: forcing.diffuseFraction,
    lDown: at(forcing.lDown),
    tAir: at(forcing.tAir),
    eAir: forcing.eAir,
    pressure: at(forcing.pressure),
    wind: forcing.wind,
    zRef: forcing.zRef,
    zenith: forcing.zenith,
    dkDt: forcing.dkDt,
  };
  return { inputs, forcing: weather, params: { ...seb.params } };
}

export type SurfaceLeverKey = 'roofAlbedo' | 'roadAlbedo' | 'greenRoofs';

/** A slider: from the cell as it is to the furthest change offered. */
export interface SurfaceLever {
  key: SurfaceLeverKey;
  from: number;
  to: number;
  step: number;
}

export type SurfaceSettings = Partial<Record<SurfaceLeverKey, number>>;

const share = (inputs: CellInputs, tile: TileName): number => inputs.fraction[TILE[tile]] ?? 0;

/** The changes this cell allows: roofs need roofs, roads need roads; an albedo already at the target has nothing to give. */
export function surfaceLevers(inputs: CellInputs): SurfaceLever[] {
  const levers: SurfaceLever[] = [];
  const roofAlbedo = inputs.albedo[TILE.roof] ?? Number.NaN;
  const roadAlbedo = inputs.albedo[TILE.road] ?? Number.NaN;
  if (share(inputs, 'roof') >= MIN_SHARE && roofAlbedo < ROOF_ALBEDO_TARGET) {
    levers.push({ key: 'roofAlbedo', from: roofAlbedo, to: ROOF_ALBEDO_TARGET, step: 0.01 });
  }
  if (share(inputs, 'road') >= MIN_SHARE && roadAlbedo < ROAD_ALBEDO_TARGET) {
    levers.push({ key: 'roadAlbedo', from: roadAlbedo, to: ROAD_ALBEDO_TARGET, step: 0.01 });
  }
  if (share(inputs, 'roof') >= MIN_SHARE) levers.push({ key: 'greenRoofs', from: 0, to: 1, step: 0.05 });
  return levers;
}

/** The cell with the settings applied: roof and road albedo first, then the greened share of the roofs. */
export function applySurfaces(inputs: CellInputs, settings: SurfaceSettings): CellInputs {
  let changed = inputs;
  if (settings.roofAlbedo !== undefined) changed = coolRoofs(changed, settings.roofAlbedo);
  if (settings.roadAlbedo !== undefined) changed = coolPavements(changed, settings.roadAlbedo, undefined, ['road']);
  if (settings.greenRoofs !== undefined && settings.greenRoofs > 0) changed = greenRoofs(changed, settings.greenRoofs);
  return changed;
}

/** A share of the cell that was `before` and is `after` now (the same tile for a new albedo). */
interface Patch {
  area: number;
  before: TileName;
  after: TileName;
}

function patches(inputs: CellInputs, settings: SurfaceSettings): Patch[] {
  const roof = share(inputs, 'roof');
  const green = Math.min(1, Math.max(0, settings.greenRoofs ?? 0));
  const out: Patch[] = [];
  const roofAlbedo = inputs.albedo[TILE.roof];
  if (settings.roofAlbedo !== undefined && settings.roofAlbedo !== roofAlbedo) out.push({ area: roof * (1 - green), before: 'roof', after: 'roof' });
  if (green > 0) out.push({ area: roof * green, before: 'roof', after: 'grass' });
  if (settings.roadAlbedo !== undefined && settings.roadAlbedo !== inputs.albedo[TILE.road]) {
    out.push({ area: share(inputs, 'road'), before: 'road', after: 'road' });
  }
  return out.filter((patch) => patch.area > 0);
}

export interface SurfaceResult {
  /** Cell surface temperature by the physics model as it is and with the changes, °C. */
  before: number;
  after: number;
  /** after − before, K. */
  delta: number;
  /** Mean change on the treated surfaces, K; null when nothing is treated. */
  treated: number | null;
  /** Share of the cell treated, 0–1. */
  treatedShare: number;
  /** Every tile's balance closed, before and after; otherwise the numbers are not to be shown. */
  converged: boolean;
}

/** Solve the cell as it is; pass it to `surfaceWhatIf` to solve the baseline once per cell. */
export const baseline = (cell: SurfaceCell): CellState => solveCell(cell.inputs, cell.forcing, cell.params);

/** The change the settings make, by the physics model with the same weather and parameters. */
export function surfaceWhatIf(cell: SurfaceCell, settings: SurfaceSettings, base: CellState = baseline(cell)): SurfaceResult {
  const changed = applySurfaces(cell.inputs, settings);
  const after = solveCell(changed, cell.forcing, cell.params);
  let weighted = 0;
  let treatedShare = 0;
  for (const patch of patches(cell.inputs, settings)) {
    weighted += patch.area * ((after.tSurface[TILE[patch.after]] ?? Number.NaN) - (base.tSurface[TILE[patch.before]] ?? Number.NaN));
    treatedShare += patch.area;
  }
  return {
    before: base.tCell - KELVIN,
    after: after.tCell - KELVIN,
    delta: after.tCell - base.tCell,
    treated: treatedShare > 0 ? weighted / treatedShare : null,
    treatedShare,
    converged: closed(base, cell.inputs) && closed(after, changed),
  };
}

/** Every tile the cell has closed its balance (absent tiles do not count in the cell temperature). */
const closed = (state: CellState, inputs: CellInputs): boolean => state.converged.every((ok, k) => ok || !((inputs.fraction[k] ?? 0) > 0));
