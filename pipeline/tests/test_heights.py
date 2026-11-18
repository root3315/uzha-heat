import numpy as np
import pandas as pd
import pytest
import shapely
import shapely.affinity

from pipeline.uzha import heights


def _rect(x: float, y: float, w: float, h: float):
    return shapely.box(x, y, x + w, y + h)


def test_shape_features_of_a_five_storey_block():
    block = np.array([shapely.affinity.rotate(_rect(0, 0, 70, 12), 30)])
    f = heights.shape_features(block, np.array(["apartments"]), (0.0, 0.0), np.array([14.0])).iloc[0]
    assert f["area"] == pytest.approx(840)
    assert f["rect_long"] == pytest.approx(70) and f["rect_short"] == pytest.approx(12)
    assert f["elongation"] == pytest.approx(70 / 12)
    assert f["compactness"] == pytest.approx(4 * np.pi * 840 / 164 ** 2)
    assert f["n_vertices"] == 4
    assert f["type_prior"] == heights.TYPE_PRIOR_M["apartments"]
    assert f["ghsl_h"] == 14.0


def test_unknown_types_get_the_default_prior():
    assert heights.type_prior(["yes", "palace", None]).tolist() == [6.0, heights.DEFAULT_PRIOR_M, heights.DEFAULT_PRIOR_M]


def test_neighbours_leave_the_building_itself_out():
    near = heights.neighbours(np.array([0.0, 50.0, 400.0]), np.zeros(3), 100.0)
    assert near.shape == (3,)  # equal-length lists must not turn into a 2D array
    assert near[0].tolist() == [1] and near[1].tolist() == [0] and near[2].tolist() == []


def test_neighbour_heights_use_only_allowed_labels():
    near = heights.index_lists([np.array([1, 2]), np.array([0, 2]), np.array([0, 1])])
    known = np.array([10.0, 20.0, 30.0])
    usable = np.array([True, False, True])  # building 1 is held out: its height must not leak to the others
    f = heights.neighbour_heights(near, known, usable)
    assert f["neigh_height_mean_150"].tolist() == [30.0, 20.0, 10.0]
    assert f["neigh_height_max_150"].tolist() == [30.0, 30.0, 10.0]
    assert f["neigh_labeled_150"].tolist() == [1, 2, 1]


def test_density_features_skip_the_building_itself():
    near = heights.index_lists([np.array([], dtype=int), np.array([2]), np.array([1])])
    f = heights.density_features(near, np.array([500.0, 100.0, 300.0]))
    assert f["neigh_count_100"].tolist() == [0, 1, 1]
    assert f["neigh_area_mean_100"].tolist() == [0.0, 300.0, 100.0]


def test_split_holds_out_every_city():
    labeled = np.ones(100, dtype=bool)
    city = np.repeat([0, 1], [90, 10])
    train, test = heights.split(labeled, city)
    assert set(train).isdisjoint(test) and len(train) + len(test) == 100
    assert (city[test] == 1).sum() == 2


def _synthetic(n: int, labeled_share: float, seed: int = 0):
    """Buildings whose height grows with their short side, like real blocks; a share of them tagged."""
    rng = np.random.default_rng(seed)
    x, y = rng.uniform(0, 3000, n), rng.uniform(0, 3000, n)
    short = rng.uniform(6, 20, n)
    polygons = np.array([_rect(a, b, 3 * s, s) for a, b, s in zip(x, y, short)])
    base = heights.shape_features(polygons, np.full(n, "yes", dtype=object), (1500.0, 1500.0), short * 0.8)
    base = pd.concat([base, heights.density_features(heights.neighbours(base["x"], base["y"], 100.0), base["area"].to_numpy())],
                     axis=1).assign(city=np.repeat([0, 1], [n - n // 4, n // 4]))
    truth = short * 1.5 + rng.normal(0, 1, n)
    known = np.where(rng.uniform(size=n) < labeled_share, truth, np.nan)
    return base, heights.neighbours(base["x"].to_numpy(), base["y"].to_numpy(), 150.0), known, truth


def test_estimate_falls_back_to_the_type_prior_without_enough_labels():
    base, near, known, _ = _synthetic(200, 0.1)
    result = heights.estimate(base, near, known, ["a", "b"])
    tagged = np.isfinite(known)
    assert result.metrics == {}
    assert np.allclose(result.height[tagged], known[tagged]) and np.all(result.height[~tagged] == 6.0)
    assert np.all(result.confidence[~tagged] == heights.PRIOR_CONFIDENCE)


def test_estimate_learns_heights_and_reports_per_city_errors():
    base, near, known, truth = _synthetic(2400, 0.5)
    result = heights.estimate(base, near, known, ["a", "b"])
    tagged = np.isfinite(known)
    assert set(result.metrics) == {"a", "b"}
    assert result.metrics["a"]["maeModel"] < result.metrics["a"]["maeTypePrior"]
    assert np.array_equal(result.tagged, tagged) and np.all(result.confidence[tagged] == 1.0)
    modelled = result.confidence[~tagged]
    assert modelled.min() >= heights.CONFIDENCE_MIN and modelled.max() <= heights.CONFIDENCE_MAX
    assert np.mean(np.abs(result.height[~tagged] - truth[~tagged])) < 2.5
    assert result.height.min() >= heights.MIN_HEIGHT_M
