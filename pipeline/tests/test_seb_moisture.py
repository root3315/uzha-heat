"""Surface moisture from the shortwave infrared, and how the energy balance uses it."""
import numpy as np
import pytest

from pipeline.uzha.seb import calibrate, physics
from pipeline.uzha.seb.solve import solve
from pipeline.uzha.seb.types import TILE, Forcing, Params
from pipeline.uzha.sources import sentinel
from pipeline.tests.test_seb_solve import CALM, single

EDGES = {"i_dry": 0.5, "s_dry": 0.5, "i_wet": 2.0, "s_wet": 4.0}


def test_ndmi_on_known_reflectances():
    np.testing.assert_allclose(sentinel.ndmi(np.array([0.3, 0.2]), np.array([0.1, 0.3])), [0.5, -0.2])
    assert np.isnan(sentinel.ndmi(np.array([0.0]), np.array([0.0]))[0])


def test_swir_transformed_reflectance():
    # STR = (1 − R)²/(2R): R = 0.2 → 0.64/0.4 = 1.6; R = 0.5 → 0.25; R = 1 → 0
    np.testing.assert_allclose(sentinel.swir_transformed(np.array([0.2, 0.5, 1.0])), [1.6, 0.25, 0.0])
    assert np.isnan(sentinel.swir_transformed(np.array([0.0, -0.1, 1.2]))).all()


def test_optram_wetness_is_zero_on_the_dry_edge_and_one_on_the_wet_edge():
    # at NDVI 0.5 the dry edge is 0.75 and the wet edge 4.0
    w = sentinel.optram_wetness(np.array([0.75, 4.0, 2.375, 0.1, 9.0]), np.full(5, 0.5), EDGES)
    np.testing.assert_allclose(w, [0.0, 1.0, 0.5, 0.0, 1.0])


def test_optram_wetness_matches_the_ropensci_form():
    # rOPTRAM linear_soil_moisture: W = (i_d + s_d·VI − STR)/(i_d − i_w + (s_d − s_w)·VI)
    vi, value = 0.3, 1.2
    expected = (EDGES["i_dry"] + EDGES["s_dry"] * vi - value) / (
        EDGES["i_dry"] - EDGES["i_wet"] + (EDGES["s_dry"] - EDGES["s_wet"]) * vi)
    assert sentinel.optram_wetness(value, vi, EDGES) == pytest.approx(expected)


def test_edges_fitted_on_a_synthetic_trapezoid():
    rng = np.random.default_rng(0)
    vi = rng.uniform(0.0, 0.8, 200_000)
    dry = EDGES["i_dry"] + EDGES["s_dry"] * vi
    wet = EDGES["i_wet"] + EDGES["s_wet"] * vi
    value = dry + rng.uniform(0.0, 1.0, vi.size) * (wet - dry)
    edges = sentinel.fit_optram_edges(vi, value)
    # uniform between the edges: the 5th/95th percentiles sit 5 % of the width inside each edge
    for v in (0.1, 0.4, 0.7):
        width = (EDGES["i_wet"] - EDGES["i_dry"]) + (EDGES["s_wet"] - EDGES["s_dry"]) * v
        assert edges["i_dry"] + edges["s_dry"] * v == pytest.approx(0.5 + 0.5 * v + 0.05 * width, abs=0.03)
        assert edges["i_wet"] + edges["s_wet"] * v == pytest.approx(2.0 + 4.0 * v - 0.05 * width, abs=0.05)


def test_lee_pielke_beta_bounds():
    theta = np.array([0.0, 0.03, physics.THETA_CAP / 2, physics.THETA_CAP, 0.43])
    beta = physics.lee_pielke_beta(theta)
    np.testing.assert_allclose(beta[[0, 2, 3, 4]], [0.0, 0.25, 1.0, 1.0])
    assert 0.0 < beta[1] < 0.03  # air-dry loess barely evaporates
    assert np.all(np.diff(beta) >= 0.0)


def _bare_cell(theta):
    return single("bare", soil_moisture=np.full(1, theta))


def test_beta_scheme_dries_out_dry_bare_soil(monkeypatch):
    forcing = Forcing(**CALM)
    monkeypatch.setattr(physics, "BARE_SOIL_SCHEME", "sellers")
    sellers = solve(_bare_cell(0.03), forcing, Params())
    monkeypatch.setattr(physics, "BARE_SOIL_SCHEME", "beta")
    beta = solve(_bare_cell(0.03), forcing, Params())
    wet = solve(_bare_cell(0.40), forcing, Params())
    k = TILE["bare"]
    assert beta.converged[0, k] and beta.le[0, k] < 0.3 * sellers.le[0, k]
    assert beta.t_surface[0, k] > sellers.t_surface[0, k]
    assert wet.le[0, k] > 5.0 * beta.le[0, k]


def test_unknown_bare_soil_scheme_is_refused(monkeypatch):
    monkeypatch.setattr(physics, "BARE_SOIL_SCHEME", "merlin")
    with pytest.raises(ValueError):
        physics.prepare(_bare_cell(0.1), Forcing(**CALM), Params())


def test_kb_inv_bare_changes_only_the_bare_tile():
    inputs, forcing = _bare_cell(0.1), Forcing(**CALM)
    plain = physics.prepare(inputs, forcing, Params(kb_inv=6.0))
    split = physics.prepare(inputs, forcing, Params(kb_inv=6.0, kb_inv_bare=3.0))
    changed = ~np.isclose(plain.z0h, split.z0h)
    assert changed[0].tolist() == [name == "bare" for name in TILE]


def test_fit_can_take_an_optional_parameter_and_keeps_the_others():
    start = Params(d_t_air=1.0)
    values = Params.from_vector([4.0], ["kb_inv_bare"], start)
    assert values.kb_inv_bare == 4.0 and values.d_t_air == 1.0
    assert Params.bounds("kb_inv_bare") == (2.0, 12.0)
    assert np.isnan(Params().kb_inv_bare)
    assert "kb_inv_bare" not in Params.BOUNDS and calibrate.FIT_EXTRA == ()
