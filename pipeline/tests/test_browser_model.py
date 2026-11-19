import json

import numpy as np
import pandas as pd
import xgboost as xgb

from pipeline.uzha import browser_model
from pipeline.uzha.model import PARAMS


def _fitted(n=800, seed=1):
    rng = np.random.default_rng(seed)
    features = pd.DataFrame({
        "ndvi": rng.uniform(-0.05, 0.85, n),
        "tree": rng.uniform(0, 100, n),
        "albedo": rng.uniform(0.08, 0.45, n),
        "volume": rng.uniform(0, 500_000, n),
    })
    lst = (46 - 10 * features["ndvi"] - 0.04 * features["tree"] + 6e-6 * features["volume"]
           + rng.normal(0, 0.4, n)).to_numpy()
    # One thread, so the trees and the predictions are the same on every run.
    booster = xgb.XGBRegressor(**{**PARAMS, "n_jobs": 1}).fit(features, lst).get_booster()
    return booster, features


def test_slim_model_reproduces_booster_predictions():
    booster, features = _fitted()
    model = json.loads(json.dumps(browser_model.slim(booster, list(features.columns))))
    rows = features.sample(200, random_state=0)
    expected = booster.predict(xgb.DMatrix(rows))
    np.testing.assert_allclose(browser_model.predict(model, rows.to_numpy()), expected, atol=1e-5)


def test_slim_model_off_the_data_and_missing_values():
    booster, features = _fitted()
    model = browser_model.slim(booster, list(features.columns))
    rows = np.array([[1.5, 150.0, 0.9, 2e6], [-1.0, -5.0, 0.0, 0.0], [np.nan, 30.0, np.nan, 1e5]])
    expected = booster.predict(xgb.DMatrix(rows, feature_names=list(features.columns), missing=np.nan))
    np.testing.assert_allclose(browser_model.predict(model, rows), expected, atol=1e-5)


def test_slim_layout():
    booster, features = _fitted(n=300)
    model = browser_model.slim(booster, list(features.columns))
    assert model["format"] == browser_model.FORMAT
    assert model["features"] == list(features.columns)
    assert len(model["trees"]) == PARAMS["n_estimators"]
    for tree in model["trees"][:20]:
        sizes = {len(tree[key]) for key in ("feature", "value", "left", "defaultLeft")}
        assert len(sizes) == 1
        for node, feature in enumerate(tree["feature"]):
            assert (feature == -1) == (tree["left"][node] == -1)
            assert -1 <= feature < len(features.columns)


def test_document_check_rows_match_booster():
    booster, features = _fitted(n=300)
    document = browser_model.document(booster, features)
    rows = np.array(document["check"]["rows"])
    assert len(rows) == browser_model.CHECK_ROWS
    np.testing.assert_allclose(browser_model.predict(document, rows), document["check"]["prediction"], atol=1e-5)
