import dataclasses
import time

import numpy as np
import pytest

from pipeline.uzha.seb import physics
from pipeline.uzha.seb.solve import linear_sensitivity, solve, solve_setup
from pipeline.uzha.seb.types import (CP_AIR, IMPERVIOUS, KELVIN, SIGMA, TILE, TILES, VON_KARMAN, Forcing, Params,
                                     SebInputs)

N_TILES = len(TILES)
IMPERVIOUS_TILES = [TILE[name] for name in IMPERVIOUS]
# Plausible per-tile ranges (low, high) for albedo and emissivity, in TILES order.
ALBEDO = [(0.12, 0.20), (0.18, 0.26), (0.20, 0.35), (0.10, 0.60), (0.06, 0.15), (0.12, 0.35), (0.05, 0.10)]
EMISSIVITY = [(0.97, 0.99), (0.96, 0.99), (0.92, 0.97), (0.88, 0.95), (0.93, 0.96), (0.90, 0.96), (0.97, 0.99)]
OHM = [(0.11, 0.11, -12.3), (0.32, 0.54, -27.4), (0.36, 0.27, -42.4), (0.12, 0.24, -4.5),
       (0.50, 0.28, -31.4), (0.70, 0.30, -40.0), (0.50, 0.21, -39.1)]


def random_inputs(n, seed=0):
    rng = np.random.default_rng(seed)
    fraction = rng.dirichlet(np.full(N_TILES, 0.7), size=n)
    fraction[fraction < 0.02] = 0.0
    fraction /= fraction.sum(axis=1, keepdims=True)
    low, high = np.array(ALBEDO).T
    albedo = rng.uniform(low, high, size=(n, N_TILES))
    low, high = np.array(EMISSIVITY).T
    emissivity = rng.uniform(low, high, size=(n, N_TILES))
    shade = rng.uniform(0.0, 0.6, size=(n, N_TILES))
    shade[:, [TILE["roof"], TILE["tree"], TILE["water"]]] = 0.0
    ohm = np.broadcast_to(np.array(OHM), (n, N_TILES, 3)) * rng.uniform(0.8, 1.2, size=(n, N_TILES, 1))
    return SebInputs(
        fraction=fraction, albedo=albedo, emissivity=emissivity, shade=shade,
        sky_view=rng.uniform(0.4, 1.0, n), z0m=rng.uniform(0.05, 2.0, n), zd=rng.uniform(0.0, 12.0, n),
        soil_moisture=rng.uniform(0.05, 0.40, n), irrigated=rng.random(n) < 0.3, ohm=np.array(ohm),
        qf=rng.uniform(0.0, 120.0, n) * fraction[:, IMPERVIOUS_TILES].sum(axis=1), rural=rng.random(n) < 0.2)


def forcing(n=1, seed=1, **overrides):
    rng = np.random.default_rng(seed)
    values = dict(k_down=rng.uniform(700.0, 900.0, n), diffuse_fraction=np.full(n, 0.15),
                  l_down=rng.uniform(330.0, 380.0, n), t_air=rng.uniform(298.0, 310.0, n),
                  e_air=rng.uniform(0.8, 2.0, n), pressure=np.full(n, 95.0), wind=rng.uniform(0.3, 6.0, n),
                  z_ref=40.0, zenith=0.6, dk_dt=80.0)
    values.update(overrides)
    return Forcing(**values)


def single(tile, **overrides):
    """One cell made of a single tile, no shade, open sky."""
    fraction = np.zeros((1, N_TILES))
    fraction[0, TILE[tile]] = 1.0
    values = dict(fraction=fraction, albedo=np.full((1, N_TILES), 0.2), emissivity=np.full((1, N_TILES), 0.95),
                  shade=np.zeros((1, N_TILES)), sky_view=np.ones(1), z0m=np.full(1, 0.5), zd=np.full(1, 3.0),
                  soil_moisture=np.full(1, 0.2), irrigated=np.zeros(1, bool), ohm=np.zeros((1, N_TILES, 3)),
                  qf=np.zeros(1), rural=np.zeros(1, bool))
    values.update(overrides)
    return SebInputs(**values)


CALM = dict(k_down=800.0, diffuse_fraction=0.2, l_down=360.0, t_air=303.15, e_air=1.5, pressure=95.0, wind=2.0,
            z_ref=40.0, zenith=0.6, dk_dt=80.0)


def test_closure_on_random_inputs():
    n = 2000
    inputs = random_inputs(n)
    state = solve(inputs, forcing(n), Params())
    assert state.converged.all()
    assert np.abs(state.residual).max() < 0.1
    assert np.all((state.t_surface > 280.0) & (state.t_surface < 360.0))
    assert np.mean(state.stability_fallback) < 0.01
    # Each tile closes Eq. 5 with the fluxes it reports.
    np.testing.assert_allclose(state.rn + state.qf - state.h - state.le - state.dqs, state.residual, atol=1e-9)


def test_cell_mean_qf_and_temperature():
    n = 300
    inputs = random_inputs(n, seed=3)
    state = solve(inputs, forcing(n), Params())
    np.testing.assert_allclose(np.sum(inputs.fraction * state.qf, axis=1), inputs.qf, rtol=1e-12)
    present = inputs.fraction > 0
    t_min = np.where(present, state.t_surface, np.inf).min(axis=1)
    t_max = np.where(present, state.t_surface, -np.inf).max(axis=1)
    assert np.all((state.t_cell >= t_min - 1e-9) & (state.t_cell <= t_max + 1e-9))


def test_radiation_only_limit_matches_eq53():
    """ra → ∞, rs → ∞, no storage, no QF: εσT⁴ balances absorbed radiation and ΔT ≈ ΔRn / (4εσT³)."""
    inputs = single("road")
    f = Forcing(**{**CALM, "k_down": 300.0})  # weak sun, so radiative equilibrium stays inside the bracket

    def temperature(albedo):
        setup = physics.prepare(dataclasses.replace(inputs, albedo=np.full((1, N_TILES), albedo)), f, Params())
        setup.conductance_scale = 0.0
        result = solve_setup(setup)
        assert result["converged"][0, TILE["road"]]
        return result["t_surface"][0, TILE["road"]]

    t0 = temperature(0.20)
    eps = 0.95
    # Exact radiative equilibrium.
    expected = ((0.8 * 300.0 + eps * 360.0) / (eps * SIGMA)) ** 0.25
    assert t0 == pytest.approx(expected, abs=1e-6)
    d_albedo = 0.01
    d_rn = -d_albedo * 300.0
    predicted = d_rn / (4.0 * eps * SIGMA * t0 ** 3)
    assert temperature(0.20 + d_albedo) - t0 == pytest.approx(predicted, rel=0.01)


def test_hand_computed_tile_with_storage_and_qf():
    """Radiation-only roof with OHM, QF, shade: εσT⁴ = SW + εL↓ − Rn*, Rn* = (a2·dRn/dt + a3 − QF)/(1 − a1)."""
    ohm = np.zeros((1, N_TILES, 3))
    ohm[0, TILE["paved"]] = (0.4, 0.3, -30.0)
    fraction = np.zeros((1, N_TILES))
    fraction[0, TILE["paved"]] = 0.5
    fraction[0, TILE["grass"]] = 0.5
    shade = np.zeros((1, N_TILES))
    shade[0, TILE["paved"]] = 0.25
    inputs = single("paved", fraction=fraction, ohm=ohm, qf=np.full(1, 20.0), shade=shade, sky_view=np.full(1, 0.7))
    f = Forcing(**{**CALM, "k_down": 300.0})
    setup = physics.prepare(inputs, f, Params(ohm_a1_scale=1.5))
    setup.conductance_scale = 0.0
    result = solve_setup(setup)

    albedo, eps, k, diffuse = 0.2, 0.95, 300.0, 0.2
    share = 1.0 - 0.25 * (1.0 - diffuse)
    sw = (1.0 - albedo) * share * k
    l_tile = 0.7 * 360.0 + 0.3 * SIGMA * 303.15 ** 4
    a1 = 0.4 * 1.5
    qf = 20.0 / 0.5  # all QF sits on the paved half of the cell
    rn = (0.3 * sw / k * 80.0 - 30.0 - qf) / (1.0 - a1)
    expected = ((sw + eps * l_tile - rn) / (eps * SIGMA)) ** 0.25
    tile = TILE["paved"]
    # The solver stops at |F| < 1e-4 W m⁻², i.e. within ~1e-5 K and 1e-4 W m⁻² of the exact root.
    assert result["t_surface"][0, tile] == pytest.approx(expected, abs=1e-5)
    assert result["rn"][0, tile] == pytest.approx(rn, abs=1e-3)
    assert result["qf"][0, tile] == pytest.approx(qf)


def test_neutral_resistance_and_water_fluxes_by_hand():
    """At T = Ta the flow is neutral: ra = ln(z/z0m)·ln(z/z0h)/(k²u); LE of open water uses rs = 0."""
    inputs = single("water")
    f = Forcing(**CALM)
    setup = physics.prepare(inputs, f, Params())
    t = setup.t_air.copy()
    out = physics.fluxes(setup, t)
    z, z0m = 40.0 - 3.0, 0.5
    z0h = z0m * np.exp(-Params().kb_inv)  # water takes the smooth-surface kB⁻¹
    ra = np.log(z / z0m) * np.log(z / z0h) / (VON_KARMAN ** 2 * 2.0)
    p, ta, ea = 95.0, 303.15, 1.5
    rho = p * 1e3 / (287.05 * ta / (1.0 - 0.378 * ea / p))
    gamma = CP_AIR * p / (0.622 * 2.45e6)
    es = 0.6108 * np.exp(17.27 * (ta - KELVIN) / (ta - KELVIN + 237.3))
    le = rho * CP_AIR / gamma * (es - ea) / ra
    tile = TILE["water"]
    assert out["h"][0, tile] == pytest.approx(0.0, abs=1e-9)
    assert out["le"][0, tile] == pytest.approx(le, rel=1e-9)
    # Unstable (hot surface) shortens ra relative to neutral, stable lengthens it.
    ra_hot, _ = physics.aerodynamic_resistance(ta + 10.0, ta, 2.0, z, z0m, z0h)
    ra_cold, _ = physics.aerodynamic_resistance(ta - 3.0, ta, 2.0, z, z0m, z0h)
    assert ra_hot < ra < ra_cold


def test_free_convection_keeps_ra_finite_in_calm_air():
    ra, fallback = physics.aerodynamic_resistance(330.0, 305.0, 0.0, 30.0, 0.5, 0.5 * np.exp(-6.0))
    assert np.isfinite(ra) and 5.0 < ra < 200.0
    assert not fallback


def test_higher_albedo_is_cooler():
    n = 200
    inputs = random_inputs(n, seed=5)
    f = forcing(n)
    base = solve(inputs, f, Params())
    brighter = solve(dataclasses.replace(inputs, albedo=inputs.albedo + 0.1), f, Params())
    assert np.all(brighter.t_surface < base.t_surface)


def test_wetter_and_lower_resistance_is_cooler():
    n = 200
    inputs = dataclasses.replace(random_inputs(n, seed=6), soil_moisture=np.full(n, 0.12), irrigated=np.zeros(n, bool))
    f = forcing(n)
    base = solve(inputs, f, Params())
    watered = solve(dataclasses.replace(inputs, irrigated=np.ones(n, bool)), f, Params())
    veg = [TILE["tree"], TILE["grass"]]
    assert np.all(watered.t_surface[:, veg] < base.t_surface[:, veg])
    assert np.all(watered.le[:, veg] > base.le[:, veg])
    lower_rs = solve(inputs, f, Params(rs_min_tree=50.0, rs_min_grass=30.0, rs_min_crop=30.0))
    assert np.all(lower_rs.t_surface[:, veg] < base.t_surface[:, veg])
    wetter_soil = solve(dataclasses.replace(inputs, soil_moisture=np.full(n, 0.35)), f, Params())
    assert np.all(wetter_soil.t_surface[:, TILE["bare"]] < base.t_surface[:, TILE["bare"]])
    # Sealed surfaces do not evaporate.
    assert np.all(base.le[:, [TILE["roof"], TILE["road"], TILE["paved"]]] == 0.0)


def test_lambda_matches_finite_differences_and_predicts_small_changes():
    n = 300
    inputs = random_inputs(n, seed=7)
    f = forcing(n)
    params = Params()
    state = solve(inputs, f, params)
    lam = linear_sensitivity(inputs, f, params, state)
    # Λ at least the radiative feedback 4εσT³ (Eq. 52) and finite.
    assert np.all(lam > 4.0 * inputs.emissivity * SIGMA * state.t_surface ** 3 * 0.5)

    setup = physics.prepare(inputs, f, params)
    step = 0.01
    fd = -(physics.fluxes(setup, state.t_surface + step)["residual"]
           - physics.fluxes(setup, state.t_surface - step)["residual"]) / (2 * step)
    # Away from T ≈ Ta: there the stability regime switches and the free-convection wind w* ∝ H^(1/3) has an
    # infinite slope, so Λ depends on the difference step.
    smooth = np.abs(state.t_surface - setup.t_air) > 1.0
    assert smooth.mean() > 0.8
    np.testing.assert_allclose(lam[smooth], fd[smooth], rtol=0.01)

    # Eq. 51: a small albedo change moves T by ≈ δ(absorbed − stored) / Λ.
    d_albedo = 0.005
    changed = solve(dataclasses.replace(inputs, albedo=inputs.albedo + d_albedo), f, params)
    sw_change = -d_albedo * setup.shortwave_absorbed / (1.0 - inputs.albedo)
    a1 = setup.a1
    storage_change = a1 * sw_change + inputs.ohm[..., 1] * (-d_albedo) * physics.shortwave_share(inputs, f) * f.dk_dt
    predicted = (sw_change - storage_change) / lam
    np.testing.assert_allclose((changed.t_surface - state.t_surface)[smooth], predicted[smooth], rtol=0.05, atol=2e-3)


def test_air_temperature_offset_warms_surface():
    n = 100
    inputs = random_inputs(n, seed=8)
    f = forcing(n)
    base = solve(inputs, f, Params())
    warm = solve(inputs, f, Params(d_t_air=2.0))
    assert np.all(warm.t_surface > base.t_surface)


def test_bracket_failure_is_reported_not_hidden():
    inputs = single("roof", ohm=np.zeros((1, N_TILES, 3)))
    f = Forcing(**{**CALM, "k_down": 5000.0})
    state = solve(inputs, f, Params())
    tile = TILE["roof"]
    assert not state.converged[0, tile]
    assert state.t_surface[0, tile] == pytest.approx(303.15 + 45.0)
    assert abs(state.residual[0, tile]) > 0.1


def test_speed_20000_cells():
    n = 20_000
    inputs = random_inputs(n, seed=9)
    f = forcing(n)
    start = time.perf_counter()
    state = solve(inputs, f, Params())
    elapsed = time.perf_counter() - start
    assert state.converged.mean() > 0.999
    assert elapsed < 10.0, f"{elapsed:.1f} s"
