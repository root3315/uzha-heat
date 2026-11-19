"""Physical attribution of the cell temperature to factor groups (theory section 11, Eq. 54–59), and the
city-minus-ring budget with the residuals kept apart (theory section 12, Eq. 60–63).

A factor group is "reset" by putting the inputs it owns back to the reference value of the rural ring (Eq. 57). The
solver runs with the same forcing and parameters in every state, so two states differ only in the groups that were
reset. Sign convention (Eq. 57): a contribution is T(observed) − T(group at reference), so positive means the group
warms the surface.

Ownership. The groups split the inputs into disjoint pieces, so resetting one group never touches what another owns.
The tile fractions are not reset as whole rows; each row is written in coordinates that change independently and
always rebuild a row summing to 1 (see `fraction_coordinates`):

    water   = f_water                                  owned by "water"
    sealed  = (f_roof + f_road + f_paved) / (1 − water)  owned by "sealing"  (the pervious↔impervious split of land)
    tree_share = f_tree / (f_tree + f_grass)           owned by "shade"    (tree share of the vegetation)
    impervious_mix = (roof, road, paved) / impervious  not owned
    bare_share = f_bare / (f_tree + f_grass + f_bare)  not owned

Group             Owns
albedo            albedo[:, roof|road|paved]
shade             tree_share, shade[:, all tiles]
transpiration     soil_moisture, irrigated
sealing           sealed
geometry          z0m, zd, sky_view
storage           ohm[:, all tiles, a1|a2|a3]
anthropogenic     qf
water             water

Not owned by any group, so always at the observed value: emissivity, albedo of tree/grass/bare/water,
impervious_mix, bare_share, the `rural` label, and the whole forcing. Whatever those (and the forcing, e.g. the
elevation-corrected air temperature) do to the city-minus-ring contrast stays out of the factor bars and lands in
Other, which is what the app spec asks for factors without evidence (app-spec section 8.1).

A ratio whose denominator is zero (no vegetation, no land, no impervious surface) is undefined in the observed state;
it is filled from the ring (the "fill" entry of the reference), which only matters when another reset creates that
surface where there was none.
"""
from dataclasses import replace
from math import factorial

import numpy as np

from .types import IMPERVIOUS, TILE, TILES, SebInputs

FACTOR_GROUPS = {
    "albedo": ("albedo[:, roof]", "albedo[:, road]", "albedo[:, paved]"),
    "shade": ("tree_share = f_tree / (f_tree + f_grass)", "shade[:, :]"),
    "transpiration": ("soil_moisture", "irrigated"),
    "sealing": ("sealed = (f_roof + f_road + f_paved) / (1 − f_water)",),
    "geometry": ("z0m", "zd", "sky_view"),
    "storage": ("ohm[:, :, :]",),
    "anthropogenic": ("qf",),
    "water": ("water = f_water",),
}
GROUPS = tuple(FACTOR_GROUPS)

_IMP = [TILE[name] for name in IMPERVIOUS]
_FRACTION_GROUPS = {"shade", "sealing", "water"}


def fraction_coordinates(fraction: np.ndarray, fill: dict = None) -> dict:
    """Split (n, T) tile fractions into independent coordinates; undefined ratios are NaN or taken from `fill`."""
    f = np.asarray(fraction, float)
    water = f[:, TILE["water"]]
    land = 1.0 - water
    impervious = f[:, _IMP].sum(axis=1)
    vegetation = f[:, TILE["tree"]] + f[:, TILE["grass"]]
    pervious = vegetation + f[:, TILE["bare"]]
    with np.errstate(invalid="ignore", divide="ignore"):
        coords = {
            "water": water.copy(),
            "sealed": np.where(land > 0, impervious / land, np.nan),
            "impervious_mix": np.where(impervious[:, None] > 0, f[:, _IMP] / impervious[:, None], np.nan),
            "bare_share": np.where(pervious > 0, f[:, TILE["bare"]] / pervious, np.nan),
            "tree_share": np.where(vegetation > 0, f[:, TILE["tree"]] / vegetation, np.nan),
        }
    if fill is not None:
        for key, value in fill.items():
            coords[key] = np.where(np.isnan(coords[key]), value, coords[key])
    return coords


def compose_fraction(coords: dict) -> np.ndarray:
    """Rebuild (n, T) fractions from `fraction_coordinates`; rows sum to 1 by construction."""
    water = np.clip(coords["water"], 0.0, 1.0)
    land = 1.0 - water
    impervious = np.clip(coords["sealed"], 0.0, 1.0) * land
    pervious = land - impervious
    bare = np.clip(coords["bare_share"], 0.0, 1.0) * pervious
    vegetation = pervious - bare
    tree = np.clip(coords["tree_share"], 0.0, 1.0) * vegetation
    f = np.zeros((len(water), len(TILES)))
    f[:, TILE["water"]] = water
    f[:, TILE["bare"]] = bare
    f[:, TILE["tree"]] = tree
    f[:, TILE["grass"]] = vegetation - tree
    mix = np.clip(coords["impervious_mix"], 0.0, None)
    f[:, _IMP] = impervious[:, None] * mix / mix.sum(axis=1, keepdims=True)
    return f


def weighted_median(values: np.ndarray, weights: np.ndarray) -> float:
    """Weighted median along the first axis; NaN values and non-positive weights are ignored."""
    values = np.asarray(values, float)
    weights = np.asarray(weights, float)
    if values.ndim > 1:
        flat = values.reshape(len(values), -1)
        w = weights.reshape(len(weights), -1) if weights.ndim > 1 else np.repeat(weights[:, None], flat.shape[1], 1)
        out = [weighted_median(flat[:, j], w[:, j]) for j in range(flat.shape[1])]
        return np.array(out).reshape(values.shape[1:])
    keep = np.isfinite(values) & (weights > 0)
    if not keep.any():
        return np.nan
    order = np.argsort(values[keep])
    v, w = values[keep][order], weights[keep][order]
    cumulative = np.cumsum(w)
    return float(v[np.searchsorted(cumulative, 0.5 * cumulative[-1])])


def _ring_median(values, weights, ring_area):
    """Median weighted by area × the share the value applies to; plain area weights if that share is zero."""
    values = np.asarray(values, float)
    result = np.asarray(weighted_median(values, weights), float)
    if np.isnan(result).any():
        area = np.broadcast_to(ring_area.reshape((-1,) + (1,) * (values.ndim - 1)), values.shape)
        result = np.where(np.isnan(result), weighted_median(values, area), result)
    return result if result.ndim else float(result)


def reference_state(inputs: SebInputs, rural_mask: np.ndarray, cell_area: np.ndarray = None) -> dict:
    """Reference value of every group: area-weighted medians over the ring cells (Eq. 57, "reset to reference").

    A per-tile property is weighted by cell area × that tile's fraction, so the reference roof albedo is the albedo
    of the typical square metre of ring roof. Returns {group: {name: value}} plus "fill" for undefined ratios.
    """
    ring = np.asarray(rural_mask, bool)
    if not ring.any():
        raise ValueError("reference_state: the ring has no cells")
    n = len(inputs.z0m)
    area = np.ones(n) if cell_area is None else np.asarray(cell_area, float)
    a = area[ring]
    f = inputs.fraction[ring]
    coords = fraction_coordinates(inputs.fraction)
    c = {key: value[ring] for key, value in coords.items()}
    land = 1.0 - c["water"]
    impervious = f[:, _IMP].sum(axis=1)
    vegetation = f[:, TILE["tree"]] + f[:, TILE["grass"]]
    pervious = vegetation + f[:, TILE["bare"]]

    tree_share = _ring_median(c["tree_share"], a * vegetation, a)
    imp_total = (a[:, None] * f[:, _IMP]).sum(axis=0)
    impervious_mix = imp_total / imp_total.sum() if imp_total.sum() > 0 else np.full(len(_IMP), 1.0 / len(_IMP))
    bare_share = _ring_median(c["bare_share"], a * pervious, a)
    return {
        "albedo": {"albedo": _ring_median(inputs.albedo[ring][:, _IMP], a[:, None] * f[:, _IMP], a)},
        "shade": {"tree_share": tree_share, "shade": _ring_median(inputs.shade[ring], a[:, None] * f, a)},
        "transpiration": {
            "soil_moisture": weighted_median(inputs.soil_moisture[ring], a),
            "irrigated": bool(_ring_median(inputs.irrigated[ring].astype(float), a * vegetation, a) >= 0.5),
        },
        "sealing": {"sealed": _ring_median(c["sealed"], a * land, a)},
        "geometry": {name: weighted_median(getattr(inputs, name)[ring], a) for name in ("z0m", "zd", "sky_view")},
        "storage": {"ohm": _ring_median(inputs.ohm[ring], np.repeat((a[:, None] * f)[:, :, None], 3, axis=2), a)},
        "anthropogenic": {"qf": weighted_median(inputs.qf[ring], a)},
        "water": {"water": weighted_median(c["water"], a)},
        "fill": {
            "tree_share": 0.5 if np.isnan(tree_share) else tree_share,
            "bare_share": 0.5 if np.isnan(bare_share) else bare_share,
            "impervious_mix": impervious_mix,
            "sealed": 0.0,
        },
    }


def apply(inputs: SebInputs, groups_to_reset, reference: dict) -> SebInputs:
    """A copy of `inputs` with the given groups set to the reference; tile fraction rows still sum to 1."""
    groups_to_reset = set(groups_to_reset)
    unknown = groups_to_reset - set(GROUPS)
    if unknown:
        raise ValueError(f"apply: unknown factor groups {sorted(unknown)}")
    n = len(inputs.z0m)
    changes = {}
    if "albedo" in groups_to_reset:
        albedo = inputs.albedo.copy()
        albedo[:, _IMP] = reference["albedo"]["albedo"]
        changes["albedo"] = albedo
    if "shade" in groups_to_reset:
        changes["shade"] = np.broadcast_to(reference["shade"]["shade"], inputs.shade.shape).astype(float)
    if "transpiration" in groups_to_reset:
        changes["soil_moisture"] = np.full(n, reference["transpiration"]["soil_moisture"])
        changes["irrigated"] = np.full(n, reference["transpiration"]["irrigated"])
    if "geometry" in groups_to_reset:
        for name, value in reference["geometry"].items():
            changes[name] = np.full(n, value)
    if "storage" in groups_to_reset:
        changes["ohm"] = np.broadcast_to(reference["storage"]["ohm"], inputs.ohm.shape).astype(float)
    if "anthropogenic" in groups_to_reset:
        changes["qf"] = np.full(n, reference["anthropogenic"]["qf"])
    if groups_to_reset & _FRACTION_GROUPS:
        coords = fraction_coordinates(inputs.fraction, reference["fill"])
        if "shade" in groups_to_reset:
            coords["tree_share"] = np.full(n, reference["shade"]["tree_share"])
        if "sealing" in groups_to_reset:
            coords["sealed"] = np.full(n, reference["sealing"]["sealed"])
        if "water" in groups_to_reset:
            coords["water"] = np.full(n, reference["water"]["water"])
        changes["fraction"] = compose_fraction(coords)
    return replace(inputs, **changes)


def _default_solve():
    from .solve import solve

    return solve


def _cell_temperature(solve, inputs, forcing, params) -> np.ndarray:
    state = solve(inputs, forcing, params)
    if state.t_cell is None:
        raise ValueError("the solver returned no t_cell")
    return np.asarray(state.t_cell, float)


def coalition_temperatures(inputs, forcing, params, reference, solve=None, groups=GROUPS) -> np.ndarray:
    """(2^G, n) cell temperature of every coalition; bit i of the row index set = group i kept as observed.

    Each coalition is solved once; Shapley, reset-to-reference and interactions can all be read from this table.
    """
    solve = solve or _default_solve()
    groups = tuple(groups)
    table = np.empty((2 ** len(groups), len(inputs.z0m)))
    for mask in range(2 ** len(groups)):
        reset = [g for i, g in enumerate(groups) if not mask >> i & 1]
        table[mask] = _cell_temperature(solve, apply(inputs, reset, reference), forcing, params)
    return table


def shapley_from_table(table: np.ndarray, n_groups: int) -> np.ndarray:
    """(n, G) Shapley values (Eq. 59) from a `coalition_temperatures` table."""
    masks = np.arange(2 ** n_groups)
    size = np.array([bin(m).count("1") for m in masks])
    weight = np.array([factorial(s) * factorial(n_groups - s - 1) / factorial(n_groups) for s in range(n_groups)])
    phi = np.empty((table.shape[1], n_groups))
    for i in range(n_groups):
        without = masks[(masks >> i & 1) == 0]
        phi[:, i] = weight[size[without]] @ (table[without | 1 << i] - table[without])
    return phi


def shapley(inputs, forcing, params, reference, solve=None, groups=GROUPS) -> np.ndarray:
    """(n, G) Shapley contribution of each group to the cell temperature, K (Eq. 59), exact over all 2^G coalitions.

    Efficiency: the row sum is T(all observed) − T(all at reference).
    """
    table = coalition_temperatures(inputs, forcing, params, reference, solve, groups)
    return shapley_from_table(table, len(tuple(groups)))


def one_at_a_time(inputs, forcing, params, reference, solve=None, groups=GROUPS) -> np.ndarray:
    """(n, G) reset-to-reference contributions (Eq. 57): T(observed) − T(only group g at reference). G + 1 solves."""
    solve = solve or _default_solve()
    observed = _cell_temperature(solve, inputs, forcing, params)
    return np.stack([observed - _cell_temperature(solve, apply(inputs, [g], reference), forcing, params)
                     for g in groups], axis=1)


def interaction(inputs, forcing, params, reference, pair, solve=None) -> np.ndarray:
    """(n,) interaction of two groups (Eq. 58): T(i, j) − T(i, 0) − T(0, j) + T(0, 0), 0 = at reference.

    All other groups stay as observed. Zero means the two effects add up.
    """
    solve = solve or _default_solve()
    i, j = pair

    def t(reset):
        return _cell_temperature(solve, apply(inputs, reset, reference), forcing, params)

    return t([]) - t([j]) - t([i]) + t([i, j])


def _area_mean(values, mask, area):
    weight = area * mask
    return float((weight * values).sum() / weight.sum())


def budget(phi, t_observed_K, inside_mask, model_t, ring_mask=None, cell_area=None, groups=GROUPS) -> dict:
    """City-minus-ring budget of the heat island, every term as an area-weighted contrast (Eq. 60), K.

    observed          contrast of the satellite temperature
    groups            contrast of each group's φ; explained = their sum
    other             observed − explained, the attribution residual (Eq. 63)
    model             contrast of the modelled temperature
    model_gap         contrast of the observed − model residual (Eq. 62) = observed − model
    reference_state   model − explained: the contrast left when every group is at reference (forcing and inputs no
                      group owns); with exact Shapley φ, other = model_gap + reference_state

    All contrasts use the same matched cells: those where observation, model and φ are all finite. The ring defaults
    to the cells outside `inside_mask`.
    """
    phi = np.asarray(phi, float)
    obs = np.asarray(t_observed_K, float)
    model = np.asarray(model_t, float)
    inside = np.asarray(inside_mask, bool)
    ring = ~inside if ring_mask is None else np.asarray(ring_mask, bool)
    area = np.ones(len(obs)) if cell_area is None else np.asarray(cell_area, float)
    valid = np.isfinite(obs) & np.isfinite(model) & np.isfinite(phi).all(axis=1)
    inside, ring = inside & valid, ring & valid
    if not inside.any() or not ring.any():
        raise ValueError("budget: no valid cells inside or in the ring")

    def contrast(values):
        return _area_mean(values, inside, area) - _area_mean(values, ring, area)

    observed = contrast(np.where(valid, obs, 0.0))
    model_contrast = contrast(np.where(valid, model, 0.0))
    group_contrast = {g: contrast(np.where(valid, phi[:, k], 0.0)) for k, g in enumerate(groups)}
    explained = sum(group_contrast.values())
    return {
        "observed": observed,
        "groups": group_contrast,
        "explained": explained,
        "other": observed - explained,
        "model": model_contrast,
        "model_gap": contrast(np.where(valid, obs - model, 0.0)),
        "reference_state": model_contrast - explained,
        "cells": {"inside": int(inside.sum()), "ring": int(ring.sum())},
    }
