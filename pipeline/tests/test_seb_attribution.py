from dataclasses import replace

import numpy as np
import pytest

from pipeline.uzha.seb import attribution, scenarios
from pipeline.uzha.seb.attribution import GROUPS
from pipeline.uzha.seb.types import (CANYON_FLOOR, CP_AIR, IMPERVIOUS, SIGMA, TILE, TILES, VON_KARMAN, Forcing,
                                     Params, SebInputs, TileState)

N_RING = 4
N_CITY = 8
T = len(TILES)


def stand_in_solve(inputs, forcing, params):
    """A linearised tile balance: T_k = T_air + (Rn* + QF − ΔQS − LE) / λ, with λ = 4εσT³ + ρc_p/r_a.

    Not the real physics, but every factor group acts through it and several of them interact (shade × albedo,
    moisture × sunlight, roughness × everything), so Shapley and one-at-a-time differ.
    """
    n = len(inputs.z0m)
    t_air = np.broadcast_to(forcing.t_air, (n,))[:, None]
    k_down = np.broadcast_to(forcing.k_down, (n,))[:, None]
    diffuse = np.broadcast_to(forcing.diffuse_fraction, (n,))[:, None]
    l_down = np.broadcast_to(forcing.l_down, (n,))[:, None]
    wind = np.broadcast_to(forcing.wind, (n,))
    floor = np.isin(np.array(TILES), CANYON_FLOOR)[None, :]
    sky = np.where(floor, inputs.sky_view[:, None], 1.0)
    sw = (1 - inputs.albedo) * (k_down * (1 - diffuse) * (1 - inputs.shade) + k_down * diffuse * sky)
    lw = inputs.emissivity * (sky * l_down + (1 - sky) * SIGMA * t_air ** 4 - SIGMA * t_air ** 4)
    impervious = np.isin(np.array(TILES), IMPERVIOUS)[None, :]
    imp_area = (inputs.fraction * impervious).sum(axis=1, keepdims=True)
    qf = np.where(impervious & (imp_area > 0), inputs.qf[:, None] / np.where(imp_area > 0, imp_area, 1), 0.0)
    rn = sw + lw
    dqs = inputs.ohm[:, :, 0] * rn + inputs.ohm[:, :, 2]
    beta = np.where(inputs.irrigated, 1.0, np.minimum(1.0, inputs.soil_moisture / 0.3))[:, None]
    evap = np.zeros((n, T))
    evap[:, TILE["tree"]] = 0.5
    evap[:, TILE["grass"]] = 0.4
    evap[:, TILE["bare"]] = 0.15
    le = np.where(evap > 0, evap * beta * rn, 0.0)
    le[:, TILE["water"]] = 0.6 * rn[:, TILE["water"]]
    r_a = np.log((forcing.z_ref - inputs.zd) / inputs.z0m) ** 2 / (VON_KARMAN ** 2 * wind)
    lam = 4 * inputs.emissivity * SIGMA * t_air ** 3 + 1.2 * CP_AIR / r_a[:, None]
    t_surface = t_air + (rn + qf - dqs - le) / lam
    zeros = np.zeros((n, T))
    return TileState(t_surface, rn, zeros, le, dqs, qf, zeros, np.ones((n, T), bool),
                     t_cell=(inputs.fraction * t_surface).sum(axis=1))


def _forcing(n):
    return Forcing(k_down=np.full(n, 850.0), diffuse_fraction=np.full(n, 0.15), l_down=np.full(n, 360.0),
                   t_air=np.full(n, 305.0), e_air=np.full(n, 1.5), pressure=np.full(n, 95.0), wind=np.full(n, 2.0),
                   z_ref=40.0, zenith=0.5, dk_dt=60.0)


def _city(seed=0, owned_only=False):
    """Ring cells all identical (so the reference is exactly a ring cell), city cells varied.

    With `owned_only` the city differs from the ring only in what the factor groups own: the roof/road/paved mix and
    the bare share of pervious land are the ring's.
    """
    rng = np.random.default_rng(seed)
    n = N_RING + N_CITY
    ring_fraction = np.array([0.15, 0.45, 0.25, 0.05, 0.05, 0.05, 0.0])
    fraction = np.tile(ring_fraction, (n, 1))
    city = rng.dirichlet(np.ones(T), N_CITY)
    city[0] = [0.0, 0.0, 0.0, 0.0, 0.5, 0.5, 0.0]  # no roof, no vegetation
    fraction[N_RING:] = city
    if owned_only:
        coords = attribution.fraction_coordinates(fraction, {"tree_share": 0.5})
        for key in ("impervious_mix", "bare_share"):
            coords[key][N_RING:] = coords[key][0]
        fraction = attribution.compose_fraction(coords)
    albedo = np.tile([0.16, 0.22, 0.25, 0.20, 0.12, 0.18, 0.06], (n, 1))
    albedo[N_RING:, [TILE[t] for t in IMPERVIOUS]] = rng.uniform(0.08, 0.3, (N_CITY, 3))
    shade = np.zeros((n, T))
    shade[N_RING:] = rng.uniform(0.0, 0.5, (N_CITY, T))
    ohm = np.tile([0.2, 0.3, -30.0], (n, T, 1))
    ohm[N_RING:, :, 0] = rng.uniform(0.2, 0.7, (N_CITY, T))
    rural = np.arange(n) < N_RING
    inputs = SebInputs(
        fraction=fraction, albedo=albedo, emissivity=np.full((n, T), 0.95), shade=shade,
        sky_view=np.where(rural, 1.0, rng.uniform(0.4, 0.9, n)), z0m=np.where(rural, 0.1, rng.uniform(0.3, 1.5, n)),
        zd=np.where(rural, 0.3, rng.uniform(2.0, 8.0, n)), soil_moisture=np.where(rural, 0.25, rng.uniform(0.05, 0.3, n)),
        irrigated=np.where(rural, True, rng.uniform(size=n) > 0.5), ohm=ohm,
        qf=np.where(rural, 0.0, rng.uniform(5.0, 60.0, n)), rural=rural)
    return inputs, _forcing(n), Params()


@pytest.fixture(scope="module")
def city():
    inputs, forcing, params = _city()
    reference = attribution.reference_state(inputs, inputs.rural)
    table = attribution.coalition_temperatures(inputs, forcing, params, reference, stand_in_solve)
    return inputs, forcing, params, reference, table


def test_groups_partition_the_named_inputs():
    owned = [item for items in attribution.FACTOR_GROUPS.values() for item in items]
    assert len(owned) == len(set(owned))
    assert set(GROUPS) == {"albedo", "shade", "transpiration", "sealing", "geometry", "storage", "anthropogenic",
                           "water"}


def test_reference_is_the_ring_cell(city):
    inputs, _, _, reference, _ = city
    reset = attribution.apply(inputs, GROUPS, reference)
    ring = slice(0, N_RING)
    for name in ("fraction", "albedo", "shade", "sky_view", "z0m", "zd", "soil_moisture", "irrigated", "ohm", "qf"):
        np.testing.assert_allclose(getattr(reset, name)[ring], getattr(inputs, name)[ring], atol=1e-12, err_msg=name)


def test_apply_keeps_fractions_summing_to_one(city):
    inputs, _, _, reference, _ = city
    for k in range(len(GROUPS) + 1):
        for groups in (GROUPS[:k], GROUPS[k:]):
            f = attribution.apply(inputs, groups, reference).fraction
            np.testing.assert_allclose(f.sum(axis=1), 1.0, atol=1e-12)
            assert (f >= 0).all()
    np.testing.assert_allclose(attribution.apply(inputs, [], reference).fraction, inputs.fraction)


def test_fraction_groups_only_touch_their_coordinate(city):
    inputs, _, _, reference, _ = city
    before = attribution.fraction_coordinates(inputs.fraction, reference["fill"])
    after = attribution.fraction_coordinates(attribution.apply(inputs, ["sealing"], reference).fraction,
                                             reference["fill"])
    for key in ("water", "tree_share", "bare_share", "impervious_mix"):
        np.testing.assert_allclose(after[key], before[key], atol=1e-12, err_msg=key)
    np.testing.assert_allclose(after["sealed"], reference["sealing"]["sealed"])


def test_shapley_efficiency(city):
    inputs, forcing, params, reference, table = city
    phi = attribution.shapley_from_table(table, len(GROUPS))
    observed = stand_in_solve(inputs, forcing, params).t_cell
    all_reference = stand_in_solve(attribution.apply(inputs, GROUPS, reference), forcing, params).t_cell
    np.testing.assert_allclose(phi.sum(axis=1), observed - all_reference, atol=1e-6)
    assert np.abs(phi[N_RING:]).max() > 0.1  # the city really differs from the ring
    np.testing.assert_allclose(phi[:N_RING], 0.0, atol=1e-9)  # the ring cells are the reference


def test_shapley_matches_full_call_and_interacting_groups_differ_from_one_at_a_time(city):
    inputs, forcing, params, reference, table = city
    groups = ("albedo", "shade", "anthropogenic")
    phi = attribution.shapley(inputs, forcing, params, reference, stand_in_solve, groups)
    oat = attribution.one_at_a_time(inputs, forcing, params, reference, stand_in_solve, groups)
    pair = attribution.interaction(inputs, forcing, params, reference, ("albedo", "shade"), stand_in_solve)
    assert phi.shape == oat.shape == (len(inputs.z0m), 3)
    assert np.abs(pair[N_RING:]).max() > 1e-3  # shade scales the sunlight albedo works on
    # With three groups and one interacting pair, Shapley splits the pair's interaction evenly.
    np.testing.assert_allclose(phi[:, 0], oat[:, 0] - pair / 2, atol=1e-9)
    np.testing.assert_allclose(phi[:, 1], oat[:, 1] - pair / 2, atol=1e-9)
    np.testing.assert_allclose(phi[:, 2], oat[:, 2], atol=1e-9)  # qf adds linearly in the stand-in


def test_symmetric_factors_get_equal_shares():
    inputs, forcing, params = _city()
    reference = attribution.reference_state(inputs, inputs.rural)
    inputs.qf[:] = 100.0
    inputs.sky_view[:] = 0.5
    reference["anthropogenic"]["qf"] = 0.0
    reference["geometry"]["sky_view"] = 1.0

    def symmetric(state, forcing, params):
        x, y = state.qf / 100.0, (1.0 - state.sky_view) / 0.5
        zeros = np.zeros((len(x), T))
        return TileState(zeros, zeros, zeros, zeros, zeros, zeros, zeros, zeros, t_cell=300 + x + y + 2 * x * y)

    phi = attribution.shapley(inputs, forcing, params, reference, symmetric)
    k_qf, k_geo = GROUPS.index("anthropogenic"), GROUPS.index("geometry")
    np.testing.assert_allclose(phi[:, k_qf], phi[:, k_geo], atol=1e-12)
    np.testing.assert_allclose(phi[:, k_qf], 2.0, atol=1e-12)
    others = [k for k in range(len(GROUPS)) if k not in (k_qf, k_geo)]
    np.testing.assert_allclose(phi[:, others], 0.0, atol=1e-12)
    interaction = attribution.interaction(inputs, forcing, params, reference, ("anthropogenic", "geometry"), symmetric)
    np.testing.assert_allclose(interaction, 2.0, atol=1e-12)


def test_group_that_changes_nothing_gets_zero():
    inputs, forcing, params = _city()
    inputs.qf[:] = 0.0  # the city has no more waste heat than the ring
    reference = attribution.reference_state(inputs, inputs.rural)
    phi = attribution.shapley(inputs, forcing, params, reference, stand_in_solve)
    np.testing.assert_allclose(phi[:, GROUPS.index("anthropogenic")], 0.0, atol=1e-12)


def test_budget_other_is_observed_minus_model_when_factors_explain_the_model():
    inputs, forcing, params = _city(owned_only=True)
    reference = attribution.reference_state(inputs, inputs.rural)
    phi = attribution.shapley(inputs, forcing, params, reference, stand_in_solve)
    model = stand_in_solve(inputs, forcing, params).t_cell
    rng = np.random.default_rng(3)
    observed = model + rng.normal(0.5, 1.0, len(model))
    observed[N_RING + 1] = np.nan  # a cloudy cell is left out of every contrast
    inside = ~inputs.rural
    result = attribution.budget(phi, observed, inside, model)
    # The all-reference state is uniform here, so the factors carry the whole model contrast ...
    assert result["reference_state"] == pytest.approx(0.0, abs=1e-9)
    assert result["explained"] == pytest.approx(result["model"], abs=1e-9)
    # ... and Other is exactly the model–observation gap, reported on its own.
    assert result["other"] == pytest.approx(result["observed"] - result["model"], abs=1e-9)
    assert result["other"] == pytest.approx(result["model_gap"], abs=1e-9)
    assert result["cells"] == {"inside": N_CITY - 1, "ring": N_RING}
    assert sum(result["groups"].values()) == pytest.approx(result["explained"])


def test_budget_keeps_the_reference_contrast_out_of_the_factors(city):
    inputs, forcing, params, reference, table = city
    phi = attribution.shapley_from_table(table, len(GROUPS))
    forcing.t_air = np.where(inputs.rural, 305.0, 306.0)  # the city sits lower: warmer air, owned by no group
    try:
        model = stand_in_solve(inputs, forcing, params).t_cell
        result = attribution.budget(phi, model, ~inputs.rural, model)
        assert result["model_gap"] == pytest.approx(0.0)
        assert result["other"] == pytest.approx(result["reference_state"])
        assert result["reference_state"] > 0.5
        assert result["other"] == pytest.approx(result["model_gap"] + result["reference_state"])
    finally:
        forcing.t_air = np.full(len(inputs.z0m), 305.0)


@pytest.mark.parametrize("name", list(scenarios.SCENARIOS))
def test_scenarios_keep_fractions_and_report_both_numbers(name):
    inputs, forcing, params = _city()
    scenario = scenarios.SCENARIOS[name](inputs)
    f = scenario.inputs.fraction
    np.testing.assert_allclose(f.sum(axis=1), 1.0, atol=1e-12)
    assert (f >= 0).all()
    assert scenario.assumptions and all({"id", "text"} <= set(a) for a in scenario.assumptions)
    result = scenarios.run_scenario(inputs, forcing, params, scenario, stand_in_solve)
    assert np.isfinite(result["mean_whole"]) and np.isfinite(result["mean_treated"])
    assert result["mean_treated"] < 0  # every default intervention cools what it treats
    untouched = ~scenario.eligible
    np.testing.assert_allclose(result["dt_whole"][untouched], 0.0, atol=1e-12)
    assert np.isnan(result["dt_treated"][untouched]).all()


def test_cool_roofs_do_nothing_without_roofs():
    inputs, forcing, params = _city()
    no_roof = inputs.fraction[:, TILE["roof"]] == 0
    assert no_roof[N_RING]
    scenario = scenarios.cool_roofs(inputs)
    assert not scenario.eligible[no_roof].any()
    np.testing.assert_array_equal(scenario.inputs.albedo[no_roof], inputs.albedo[no_roof])
    result = scenarios.run_scenario(inputs, forcing, params, scenario, stand_in_solve)
    assert result["dt_whole"][N_RING] == 0.0
    roofed = scenario.eligible
    assert (result["dt_whole"][roofed] < 0).all()
    np.testing.assert_allclose(scenario.inputs.albedo[roofed, TILE["roof"]], 0.55)


def test_scenarios_respect_the_drawn_area():
    inputs, forcing, params = _city()
    where = np.zeros(len(inputs.z0m), bool)
    where[-2:] = True
    scenario = scenarios.trees(inputs, where=where, share=0.2, irrigated=True)
    assert not scenario.eligible[:-2].any()
    np.testing.assert_array_equal(scenario.inputs.fraction[:-2], inputs.fraction[:-2])
    added = scenario.inputs.fraction[:, TILE["tree"]] - inputs.fraction[:, TILE["tree"]]
    available = inputs.fraction[:, [TILE["paved"], TILE["bare"]]].sum(axis=1)
    np.testing.assert_allclose(added[-2:], np.minimum(0.2, available[-2:]))
    assert scenario.inputs.irrigated[-2:].all()


def test_waste_heat_scales_qf():
    inputs, _, _ = _city()
    scenario = scenarios.waste_heat(inputs, reduction=0.25)
    np.testing.assert_allclose(scenario.inputs.qf, inputs.qf * np.where(inputs.qf > 0, 0.75, 1.0))


def test_cool_coatings_never_darken_a_surface_already_brighter():
    inputs, _, _ = _city()
    bright = inputs.albedo.copy()
    bright[:, TILE["roof"]] = 0.70
    bright[:, TILE["road"]] = 0.40
    brighter = replace(inputs, albedo=bright)
    roofs = scenarios.cool_roofs(brighter)
    np.testing.assert_allclose(roofs.inputs.albedo[roofs.eligible, TILE["roof"]], 0.70)
    roads = scenarios.cool_pavements(brighter)
    np.testing.assert_allclose(roads.inputs.albedo[roads.eligible, TILE["road"]], 0.40)


def test_unconverged_cells_leave_the_coalition_table():
    class State:
        t_cell = np.array([300.0, 310.0])
        converged = np.array([[True, True], [True, False]])

    t = attribution._cell_temperature(lambda *args: State(), None, None, None)
    assert t[0] == 300.0 and np.isnan(t[1])
