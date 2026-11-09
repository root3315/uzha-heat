import numpy as np
import pandas as pd

from pipeline.uzha.model import explain, fit, global_importance, spatial_blocks


def _synthetic(n=600, seed=0):
    rng = np.random.default_rng(seed)
    x = rng.uniform(0, 10_000, n)
    y = rng.uniform(0, 10_000, n)
    features = pd.DataFrame({"ndvi": rng.uniform(0, 0.8, n), "built": rng.uniform(0, 100, n),
                             "noise": rng.normal(size=n)})
    lst = 45 - 12 * features["ndvi"] + 0.05 * features["built"] + rng.normal(0, 0.3, n)
    return features, lst.to_numpy(), x, y


def test_spatial_blocks_group_by_2km_squares():
    groups = spatial_blocks(np.array([100, 1900, 2100, 100]), np.array([100, 1900, 100, 2100]))
    assert groups[0] == groups[1]
    assert len({groups[0], groups[2], groups[3]}) == 3


def test_shap_plus_base_equals_prediction():
    features, lst, _, _ = _synthetic()
    prediction, shap, base = explain(features, lst)
    np.testing.assert_allclose(shap.sum(axis=1).to_numpy() + base, prediction, atol=1e-3)


def test_fit_recovers_signal_and_importance_order():
    features, lst, x, y = _synthetic()
    result = fit(features, lst, x, y)
    assert result.r2_cv > 0.8
    importance = global_importance(features, lst, result.shap)
    assert importance[0]["key"] == "ndvi"
    assert importance[0]["correlation"] < 0
    assert importance[-1]["key"] == "noise"
    shap_order = [row["meanAbsShap"] for row in importance]
    assert shap_order == sorted(shap_order, reverse=True)
