import numpy as np
import pandas as pd

from pipeline.uzha import plan

WIDE = {"tree": (0.0, 100.0), "ndvi": (0.0, 1.0)}


def test_planting_takes_crowns_from_bare_ground_then_built_up_as_the_site_does():
    cells = pd.DataFrame({"tree": [5.0, 0.0, 5.0], "built": [80.0, 100.0, 50.0], "bare": [10.0, 0.0, 10.0],
                          "ndvi": [0.2, 0.1, 0.3]})
    out = plan.planted(cells, WIDE)
    # Same cases as balanceCover's tests in web/src/domain/whatIf.test.ts.
    assert out.loc[0, ["tree", "built", "bare"]].tolist() == [25.0, 75.0, 0.0]
    assert out.loc[1, ["tree", "built", "bare"]].tolist() == [20.0, 80.0, 0.0]
    assert out.loc[2, ["tree", "built", "bare"]].tolist() == [25.0, 50.0, 10.0]
    assert np.allclose(out["ndvi"], [0.3, 0.2, 0.4])


def test_planting_stops_at_the_city_range_but_keeps_a_cell_already_past_it():
    cells = pd.DataFrame({"tree": [0.0, 40.0], "ndvi": [0.1, 0.9]})
    out = plan.planted(cells, {"tree": (0.0, 12.0), "ndvi": (0.0, 0.5)})
    assert out["tree"].tolist() == [12.0, 40.0]
    assert np.allclose(out["ndvi"], [0.2, 0.9])


def test_ranges_are_the_5th_and_95th_percentile():
    assert plan.factor_ranges(pd.DataFrame({"tree": np.arange(101.0)}))["tree"] == (5.0, 95.0)


def test_plan_and_bootstrap_on_a_toy_city():
    rng = np.random.default_rng(0)
    n = 300
    tree, ndvi = rng.uniform(0, 30, n), rng.uniform(0, 0.6, n)
    features = pd.DataFrame({"tree": tree, "ndvi": ndvi})
    lst = 46 - 0.1 * tree - 8 * ndvi + rng.normal(0, 0.2, n)
    lon, lat = 69.2 + rng.uniform(0, 0.2, n), 41.3 + rng.uniform(0, 0.2, n)
    x, y = (lon - 69.2) * 84_000, (lat - 41.3) * 111_000
    pop = rng.integers(0, 2000, n).astype(float)
    from pipeline.uzha.model import fit_booster

    places = plan.plan(fit_booster(features, lst), features, pop, lon, lat, np.ones(n, bool))
    assert 1 <= len(places) <= plan.PLACES and all(p["cooling"] >= plan.MIN_COOLING for p in places)
    spread = plan.bootstrap_cooling(features, lst, x, y, [p["cell"] for p in places], 2, 2000.0)
    assert spread.shape == (2, len(places)) and np.isfinite(spread).all()
