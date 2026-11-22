"""What-if scenarios of app-spec section 11.2 as pure transforms of SebInputs, and their evaluation (Eq. 54–56).

A scenario only changes the inputs its intervention affects, then the same solver runs with the same forcing and
parameters (Eq. 54–56). Each transform returns a `Scenario`: the new inputs, the eligible cells, the treated patches and
the assumptions as a machine-readable list for the UI. Tile fractions always still sum to 1.

A patch is (area, tile_before, tile_after): a share of the cell (n,) that was tile_before and is tile_after now. For a
property change (cool roof) both tiles are the same; for a conversion (paved → tree) they differ, and the treated-area
change compares the new tile's temperature with the old tile's on that patch.

Properties of a tile that a conversion creates (albedo, emissivity, OHM of tree or grass) are the cell's own values for
that tile; SebInputs carries them for every tile, also where the fraction is 0.
"""
from dataclasses import dataclass, field, replace

import numpy as np

from .attribution import _area_mean, _default_solve
from .types import IMPERVIOUS, TILE, SebInputs


@dataclass
class Scenario:
    name: str
    inputs: SebInputs  # the inputs with the intervention applied
    eligible: np.ndarray  # (n,) bool: cells in the drawn area where the intervention can apply
    patches: list  # [(area (n,), tile_before, tile_after)]
    assumptions: list  # [{"id": str, "text": str}], shown beside the result
    settings: dict = field(default_factory=dict)


def _region(inputs: SebInputs, where) -> np.ndarray:
    n = len(inputs.z0m)
    return np.ones(n, bool) if where is None else np.asarray(where, bool)


def _move(fraction, shade, amount, source, target):
    """Move `amount` (n,) of cell area from tile `source` to tile `target` in place.

    The target tile's shade becomes the area-weighted mix of what it had and what the moved patch had, so the direct
    beam reaching the moved patch does not change with the label.
    """
    s, t = TILE[source], TILE[target]
    new_target = fraction[:, t] + amount
    with np.errstate(invalid="ignore", divide="ignore"):
        mixed = (fraction[:, t] * shade[:, t] + amount * shade[:, s]) / new_target
    shade[:, t] = np.where(amount > 0, mixed, shade[:, t])
    fraction[:, t] = new_target
    fraction[:, s] = np.maximum(fraction[:, s] - amount, 0.0)


def _assumption(key, text):
    return {"id": key, "text": text}


def cool_roofs(inputs: SebInputs, where=None, albedo: float = 0.55, emissivity: float = None) -> Scenario:
    """Reflective roofs: roof albedo set to `albedo` (0.55 is an aged white coating, below its fresh ~0.8).

    Eligible: cells in the drawn area with a roof fraction above 0. Emissivity stays as observed unless given.
    Nothing else changes: the roof's heat storage, the qf it carries and the shade on it are those of the old roof.
    """
    eligible = _region(inputs, where) & (inputs.fraction[:, TILE["roof"]] > 0)
    new_albedo = inputs.albedo.copy()
    roof = TILE["roof"]
    # A coating never darkens a roof that is already brighter.
    new_albedo[eligible, roof] = np.maximum(albedo, inputs.albedo[eligible, roof])
    changes = {"albedo": new_albedo}
    if emissivity is not None:
        new_emissivity = inputs.emissivity.copy()
        new_emissivity[eligible, TILE["roof"]] = emissivity
        changes["emissivity"] = new_emissivity
    assumptions = [
        _assumption("albedo", f"Every treated roof reaches albedo {albedo:.2f} (aged coating, not fresh); "
                              "roofs already brighter keep theirs."),
        _assumption("emissivity", "Roof emissivity unchanged." if emissivity is None
                    else f"Roof emissivity set to {emissivity:.2f}."),
        _assumption("all_roofs", "All roof area in the drawn cells is treated; roof slope and access are ignored."),
        _assumption("storage", "Roof heat storage (OHM) unchanged: the coating is thin."),
    ]
    return Scenario("cool_roofs", replace(inputs, **changes), eligible,
                    [(inputs.fraction[:, TILE["roof"]] * eligible, "roof", "roof")], assumptions,
                    {"albedo": albedo, "emissivity": emissivity})


def cool_pavements(inputs: SebInputs, where=None, albedo: float = 0.30, emissivity: float = None,
                   tiles=("road",)) -> Scenario:
    """Reflective pavements: albedo of the `tiles` (default road; add "paved" for parking and squares) set to 0.30.

    Eligible: cells in the drawn area where those tiles cover more than 0. Emissivity stays unless given; storage,
    shade and sky view of the street are unchanged, so extra reflected light onto walls and people is not counted.
    """
    region = _region(inputs, where)
    eligible = region & (inputs.fraction[:, [TILE[t] for t in tiles]].sum(axis=1) > 0)
    new_albedo = inputs.albedo.copy()
    new_emissivity = inputs.emissivity.copy()
    patches = []
    for tile in tiles:
        k = TILE[tile]
        treated = eligible & (inputs.fraction[:, k] > 0)
        new_albedo[treated, k] = np.maximum(albedo, inputs.albedo[treated, k])  # never darker than it was
        if emissivity is not None:
            new_emissivity[treated, k] = emissivity
        patches.append((inputs.fraction[:, k] * treated, tile, tile))
    assumptions = [
        _assumption("albedo", f"Treated {', '.join(tiles)} surfaces reach albedo {albedo:.2f}; "
                              "surfaces already brighter keep theirs."),
        _assumption("emissivity", "Pavement emissivity unchanged." if emissivity is None
                    else f"Pavement emissivity set to {emissivity:.2f}."),
        _assumption("reflection", "Light reflected onto walls and pedestrians is not modelled."),
        _assumption("storage", "Pavement heat storage (OHM) unchanged."),
    ]
    return Scenario("cool_pavements", replace(inputs, albedo=new_albedo, emissivity=new_emissivity), eligible,
                    patches, assumptions, {"albedo": albedo, "emissivity": emissivity, "tiles": list(tiles)})


def trees(inputs: SebInputs, where=None, share: float = 0.10, source=("paved", "bare"),
          irrigated: bool = False) -> Scenario:
    """Urban trees: add `share` of the cell area as tree canopy, taken from the `source` tiles.

    The new canopy comes out of the source tiles in proportion to their area, capped at what they have (a cell with
    5 % paved and bare gets 5 %, not 10 %). Eligible: cells in the drawn area with some source tile. The canopy gets
    the cell's tree properties; its shade is the shade the replaced ground had. With `irrigated` the cell's vegetation
    is marked watered (no soil-moisture stress); without, the trees live on the cell's soil moisture.
    Roughness (z0m, zd) and sky view are unchanged.
    """
    region = _region(inputs, where)
    columns = [TILE[t] for t in source]
    available = inputs.fraction[:, columns].sum(axis=1)
    eligible = region & (available > 0)
    added = np.where(eligible, np.minimum(share, available), 0.0)
    fraction, shade = inputs.fraction.copy(), inputs.shade.copy()
    patches = []
    for tile in source:
        with np.errstate(invalid="ignore", divide="ignore"):
            amount = np.where(eligible, added * inputs.fraction[:, TILE[tile]] / available, 0.0)
        _move(fraction, shade, amount, tile, "tree")
        patches.append((amount, tile, "tree"))
    changes = {"fraction": fraction, "shade": shade}
    if irrigated:
        changes["irrigated"] = inputs.irrigated | eligible
    assumptions = [
        _assumption("share", f"Canopy share added: {share:.0%} of the cell, capped at the {'/'.join(source)} area."),
        _assumption("source", f"Canopy replaces {' and '.join(source)} in proportion to their area."),
        _assumption("water", "Trees are irrigated (no water stress)." if irrigated
                    else "Trees are not irrigated: they use the cell's soil moisture."),
        _assumption("mature", "Canopy is mature: full leaf area from day one."),
        _assumption("airflow", "Cell roughness and sky view unchanged; ventilation effects are not counted."),
    ]
    return Scenario("trees", replace(inputs, **changes), eligible, patches, assumptions,
                    {"share": share, "source": list(source), "irrigated": irrigated})


def green_roofs(inputs: SebInputs, where=None, share: float = 1.0, irrigated: bool = True,
                soil_moisture: float = None) -> Scenario:
    """Green roofs: `share` of the roof area becomes vegetated, with the cell's grass properties.

    The converted roof joins the grass tile (albedo, emissivity, OHM and surface resistance of grass), keeping the shade
    the roof had. Eligible: cells in the drawn area with roofs. With `irrigated` the cell's vegetation is watered;
    `soil_moisture`, if given, is the substrate moisture and is applied to the cell (the solver has one soil moisture
    per cell). Structural feasibility is outside the app (app-spec 11.2).
    """
    roof = inputs.fraction[:, TILE["roof"]]
    eligible = _region(inputs, where) & (roof > 0)
    amount = np.where(eligible, share * roof, 0.0)
    fraction, shade = inputs.fraction.copy(), inputs.shade.copy()
    _move(fraction, shade, amount, "roof", "grass")
    changes = {"fraction": fraction, "shade": shade}
    if irrigated:
        changes["irrigated"] = inputs.irrigated | eligible
    if soil_moisture is not None:
        changes["soil_moisture"] = np.where(eligible, soil_moisture, inputs.soil_moisture)
    assumptions = [
        _assumption("share", f"{share:.0%} of the roof area is greened."),
        _assumption("properties", "Green roofs behave like the cell's grass: albedo, emissivity, storage, resistance."),
        _assumption("water", "Green roofs are irrigated." if irrigated else "Green roofs are not irrigated."),
        _assumption("soil_moisture", "Substrate moisture = the cell's soil moisture." if soil_moisture is None
                    else f"Substrate moisture {soil_moisture:.2f} m³/m³, applied to the whole cell."),
        _assumption("sky_view", "The roof-top grass uses the cell's canyon sky view, which understates its open sky."),
        _assumption("structure", "Structural feasibility is not checked."),
    ]
    return Scenario("green_roofs", replace(inputs, **changes), eligible, [(amount, "roof", "grass")], assumptions,
                    {"share": share, "irrigated": irrigated, "soil_moisture": soil_moisture})


def permeable(inputs: SebInputs, where=None, share: float = 1.0, to: str = "grass",
              soil_moisture: float = None) -> Scenario:
    """Permeable surfaces: `share` of the paved tile becomes `to` ("grass" for grass pavers, "bare" for gravel).

    Eligible: cells in the drawn area with paved surface. Roads stay sealed. If `soil_moisture` is given, the cell's
    soil moisture is raised to it (infiltration of rain that used to run off); otherwise moisture is unchanged.
    """
    if to not in ("grass", "bare"):
        raise ValueError("permeable: `to` must be 'grass' or 'bare'")
    paved = inputs.fraction[:, TILE["paved"]]
    eligible = _region(inputs, where) & (paved > 0)
    amount = np.where(eligible, share * paved, 0.0)
    fraction, shade = inputs.fraction.copy(), inputs.shade.copy()
    _move(fraction, shade, amount, "paved", to)
    changes = {"fraction": fraction, "shade": shade}
    if soil_moisture is not None:
        changes["soil_moisture"] = np.where(eligible, np.maximum(inputs.soil_moisture, soil_moisture),
                                            inputs.soil_moisture)
    assumptions = [
        _assumption("share", f"{share:.0%} of paved (non-road) area becomes permeable {to}."),
        _assumption("properties", f"The new surface has the cell's {to} properties."),
        _assumption("soil_moisture", "Soil moisture unchanged: no extra infiltration assumed." if soil_moisture is None
                    else f"Soil moisture raised to at least {soil_moisture:.2f} m³/m³ in treated cells (rainfall "
                         "assumed to infiltrate)."),
    ]
    return Scenario("permeable", replace(inputs, **changes), eligible, [(amount, "paved", to)], assumptions,
                    {"share": share, "to": to, "soil_moisture": soil_moisture})


def waste_heat(inputs: SebInputs, where=None, reduction: float = 0.3) -> Scenario:
    """Waste-heat reduction: qf × (1 − reduction) in the drawn area.

    Eligible: cells with qf above 0; the result is only as good as the qf map (app-spec: real energy-release data
    must exist). qf is spread over the impervious tiles, so those are the treated surfaces.
    """
    if not 0.0 <= reduction <= 1.0:
        raise ValueError("waste_heat: reduction must be in 0..1")
    eligible = _region(inputs, where) & (inputs.qf > 0)
    qf = np.where(eligible, inputs.qf * (1.0 - reduction), inputs.qf)
    patches = [(inputs.fraction[:, TILE[t]] * eligible, t, t) for t in IMPERVIOUS]
    assumptions = [
        _assumption("reduction", f"Human-made heat cut by {reduction:.0%} in treated cells, all sources alike."),
        _assumption("data", "Uses the model's qf map; only meaningful where real energy-release data exist."),
        _assumption("release", "The heat is released at the surface, spread over roofs, roads and paving."),
    ]
    return Scenario("waste_heat", replace(inputs, qf=qf), eligible, patches, assumptions, {"reduction": reduction})


SCENARIOS = {f.__name__: f for f in (cool_roofs, cool_pavements, trees, green_roofs, permeable, waste_heat)}


def run_scenario(inputs: SebInputs, forcing, params, scenario: Scenario, solve=None, cell_area=None,
                 study_area=None) -> dict:
    """Solve baseline and scenario with the same forcing and report the change (scenario − baseline, K).

    dt_whole    (n,) change of the cell temperature
    dt_treated  (n,) change on the treated patches, area-weighted over them (NaN where nothing is treated)
    means       whole: Eq. 60 area-weighted mean of dt_whole over `study_area` (default all cells);
                treated: mean of dt_treated weighted by cell area × treated share, over the same cells
    """
    solve = solve or _default_solve()
    base = solve(inputs, forcing, params)
    after = solve(scenario.inputs, forcing, params)
    dt_whole = np.asarray(after.t_cell, float) - np.asarray(base.t_cell, float)
    treated = np.zeros(len(dt_whole))
    weighted_change = np.zeros(len(dt_whole))
    for amount, before_tile, after_tile in scenario.patches:
        change = after.t_surface[:, TILE[after_tile]] - base.t_surface[:, TILE[before_tile]]
        weighted_change += np.where(amount > 0, amount * change, 0.0)
        treated += amount
    with np.errstate(invalid="ignore", divide="ignore"):
        dt_treated = np.where(treated > 0, weighted_change / treated, np.nan)
    area = np.ones(len(dt_whole)) if cell_area is None else np.asarray(cell_area, float)
    study = np.ones(len(dt_whole), bool) if study_area is None else np.asarray(study_area, bool)
    treated_cells = study & (treated > 0)
    return {
        "name": scenario.name,
        "t_base": np.asarray(base.t_cell, float),
        "t_scenario": np.asarray(after.t_cell, float),
        "dt_whole": dt_whole,
        "dt_treated": dt_treated,
        "treated_share": treated,
        "eligible": scenario.eligible,
        "mean_whole": _area_mean(dt_whole, study, area),
        "mean_treated": (_area_mean(np.nan_to_num(dt_treated), treated_cells, area * treated)
                         if treated_cells.any() else float("nan")),
        "assumptions": scenario.assumptions,
        "settings": scenario.settings,
    }
