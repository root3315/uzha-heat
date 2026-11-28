import json

import numpy as np
import pytest

from pipeline import seb_check
from pipeline.uzha.cache import Cache
from pipeline.uzha.seb import calibrate
from pipeline.uzha.seb.attribution import GROUPS
from pipeline.uzha.seb.scenarios import SCENARIOS
from pipeline.uzha.seb.types import TILE, TILES, Forcing, Params, SebInputs


def _city(n=120, seed=0):
    """A small synthetic city: denser, sealed cells in the middle (inside), greener ones around (the ring)."""
    rng = np.random.default_rng(seed)
    x = np.repeat(np.arange(12) * 2500.0, 10)[:n]
    y = np.tile(np.arange(10) * 2500.0, 12)[:n]
    inside = (np.abs(x - x.mean()) < 8000) & (np.abs(y - y.mean()) < 7000)
    t = len(TILES)
    fraction = rng.uniform(0.05, 1, (n, t))
    fraction[inside, TILE["roof"]] += 1.0
    fraction[~inside, TILE["grass"]] += 1.0
    fraction /= fraction.sum(axis=1, keepdims=True)
    ohm = np.tile(np.array([[0.11, 0.11, -12.3], [0.32, 0.54, -27.4], [0.35, 0.43, -36.5], [0.48, 0.34, -33.9],
                            [0.61, 0.41, -27.7], [0.83, 0.40, -54.2], [0.50, 0.21, -39.1]]), (n, 1, 1))
    inputs = SebInputs(fraction=fraction, albedo=np.tile([0.16, 0.21, 0.25, 0.2, 0.12, 0.18, 0.08], (n, 1)),
                       emissivity=np.tile([0.98, 0.95, 0.93, 0.91, 0.95, 0.9, 0.96], (n, 1)), shade=np.zeros((n, t)),
                       sky_view=np.where(inside, 0.7, 1.0), z0m=np.where(inside, 1.0, 0.1),
                       zd=np.where(inside, 5.0, 0.3), soil_moisture=np.full(n, 0.2), irrigated=inside.copy(), ohm=ohm,
                       qf=np.where(inside, 20.0, 2.0), rural=~inside)
    forcing = Forcing(k_down=np.full(n, 800.0), diffuse_fraction=np.full(n, 0.2), l_down=np.full(n, 395.0),
                      t_air=np.full(n, 305.0), e_air=np.full(n, 1.45), pressure=np.full(n, 95.8),
                      wind=np.full(n, 2.1), z_ref=60.0, zenith=0.52, dk_dt=66.0)
    factors = rng.uniform(0, 1, (n, 3))
    observed = calibrate.predict(inputs, forcing, Params(d_t_air=1.0)) + 1.5 * factors[:, 0]
    return inputs, forcing, observed, inside, factors, x, y


def test_stratified_sample_weights_stand_for_every_cell():
    rng = np.random.default_rng(1)
    inside = rng.uniform(size=1000) < 0.7
    observed = rng.normal(310, 3, 1000)
    cells, weight = seb_check.stratified_sample(inside, observed, per_side=100)
    assert len(np.unique(cells)) == len(cells)
    assert weight[inside[cells]].sum() == pytest.approx(inside.sum())
    assert weight[~inside[cells]].sum() == pytest.approx((~inside).sum())
    assert 90 <= inside[cells].sum() <= 110


def test_stratified_sample_takes_a_small_side_whole():
    inside = np.array([True] * 5 + [False] * 50)
    cells, weight = seb_check.stratified_sample(inside, np.arange(55.0), per_side=10)
    assert set(np.flatnonzero(inside)) <= set(cells)
    assert np.all(weight[inside[cells]] == 1.0)


def test_cell_fluxes_weight_tiles_by_area():
    fraction = np.array([[0.25, 0.75] + [0.0] * (len(TILES) - 2)])
    tile = np.zeros((1, len(TILES)))
    tile[0, :2] = [100.0, 200.0]

    class State:
        rn = h = le = dqs = qf = tile

    assert seb_check.cell_fluxes(fraction, State)["rn"][0] == pytest.approx(175.0)


def test_shapley_budget_adds_up_and_respects_efficiency():
    inputs, forcing, observed, inside, *_ = _city()
    budget = seb_check.shapley_budget(inputs, forcing, Params(), observed, inside, per_side=20)
    explained = sum(g["contribution"] for g in budget["groups"])
    assert [g["id"] for g in budget["groups"]] == list(GROUPS)
    assert budget["observed"] == pytest.approx(explained + budget["other"], abs=2e-3)
    assert budget["other"] == pytest.approx(budget["modelGap"] + budget["referenceState"], abs=2e-3)
    assert budget["efficiencyK"] < 1e-6


def test_scenario_changes_cool_and_report_their_assumptions():
    inputs, forcing, *_ = _city(n=40)
    changes = seb_check.scenario_changes(inputs, forcing, Params())
    assert set(changes) == set(SCENARIOS)
    assert changes["cool_roofs"]["treated"] < 0 and changes["cool_roofs"]["whole"] < 0
    # The whole-cell change is the treated change diluted by the area treated.
    assert abs(changes["cool_roofs"]["whole"]) < abs(changes["cool_roofs"]["treated"])
    assert 0 < changes["cool_roofs"]["areaShare"] < 1
    assert changes["waste_heat"]["whole"] < 0
    assert all(change["assumptions"] for change in changes.values())


def test_analyse_writes_the_contract_and_reuses_its_cache(tmp_path, monkeypatch):
    city = _city()
    cache = Cache(tmp_path)
    result = seb_check.analyse(*city, cache=cache, replicates=2, shapley_sample=15, folds=3)

    assert set(result["skill"]) == {"physics", "hybrid", "inside"}
    assert set(result["skill"]["physics"]) == {"r2", "mae", "bias"}
    assert set(result["params"]) == set(Params.BOUNDS)
    assert set(result["fluxes"]["inside"]) == set(seb_check.FLUXES)
    assert len(result["scenarios"]) == len(SCENARIOS)
    for scenario in result["scenarios"]:
        lo, mid, hi = scenario["wholeDT"]
        assert lo <= mid <= hi
        assert scenario["settings"] and scenario["assumptions"]
    json.dumps(result, allow_nan=False)

    def no_refit(*args, **kwargs):
        raise AssertionError("cached step recomputed")

    monkeypatch.setattr(calibrate, "cross_validate_hybrid", no_refit)
    monkeypatch.setattr(calibrate, "fit", no_refit)
    monkeypatch.setattr(seb_check, "scenario_changes", no_refit)
    assert seb_check.analyse(*city, cache=cache, replicates=2, shapley_sample=15, folds=3) == result


def test_publishes_only_cities_whose_physics_explains_enough():
    def result(r2):
        return {"skill": {"inside": {"physics": {"r2": r2}}}}

    assert seb_check.publishable(result(0.52))
    assert not seb_check.publishable(result(0.32))
