"""XGBoost LST model, spatial block cross-validation and per-cell SHAP contributions."""
from dataclasses import dataclass

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import GroupKFold

BLOCK_SIZE_M = 2000.0
CV_FOLDS = 5
PARAMS = {
    "n_estimators": 400,
    "max_depth": 5,
    "learning_rate": 0.05,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 10,
    "reg_lambda": 1.0,
    "tree_method": "hist",
    "random_state": 42,
    "n_jobs": -1,
}
ADDITIVITY_TOLERANCE = 1e-2


@dataclass
class ModelResult:
    r2_cv: float
    mae_cv: float
    base_value: float
    shap: pd.DataFrame  # one column per factor, °C
    prediction: np.ndarray


def spatial_blocks(x: np.ndarray, y: np.ndarray, block_size: float = BLOCK_SIZE_M) -> np.ndarray:
    """Group id of the square block (block_size metres) containing each point."""
    bx = np.floor(np.asarray(x) / block_size).astype(np.int64)
    by = np.floor(np.asarray(y) / block_size).astype(np.int64)
    return bx * 1_000_003 + by


def cross_validate(features: pd.DataFrame, target: np.ndarray, groups: np.ndarray, folds: int = CV_FOLDS) -> tuple:
    """Out-of-fold R² and MAE where whole spatial blocks are held out together."""
    predicted = np.empty(len(target))
    for train, test in GroupKFold(n_splits=folds).split(features, target, groups):
        model = xgb.XGBRegressor(**PARAMS).fit(features.iloc[train], target[train])
        predicted[test] = model.predict(features.iloc[test])
    return r2_score(target, predicted), mean_absolute_error(target, predicted)


def explain(features: pd.DataFrame, target: np.ndarray) -> tuple:
    """Fit on all cells; return (prediction, SHAP frame, base value). SHAP + base = prediction."""
    model = xgb.XGBRegressor(**PARAMS).fit(features, target)
    booster = model.get_booster()
    matrix = xgb.DMatrix(features)
    contributions = booster.predict(matrix, pred_contribs=True)
    prediction = booster.predict(matrix)
    shap = pd.DataFrame(contributions[:, :-1], columns=features.columns, index=features.index)
    base_value = float(contributions[0, -1])
    gap = np.abs(contributions.sum(axis=1) - prediction).max()
    if gap > ADDITIVITY_TOLERANCE:
        raise AssertionError(f"SHAP additivity violated by {gap:.4f} °C")
    return prediction, shap, base_value


def fit(features: pd.DataFrame, target: np.ndarray, x: np.ndarray, y: np.ndarray) -> ModelResult:
    r2, mae = cross_validate(features, target, spatial_blocks(x, y))
    prediction, shap, base_value = explain(features, target)
    return ModelResult(float(r2), float(mae), base_value, shap, prediction)


def global_importance(features: pd.DataFrame, target: np.ndarray, shap: pd.DataFrame) -> list:
    """Per factor: mean |SHAP| (°C) and Pearson correlation with LST, sorted by importance."""
    rows = [
        {
            "key": key,
            "meanAbsShap": float(shap[key].abs().mean()),
            "correlation": _pearson(features[key].to_numpy(), target),
        }
        for key in features.columns
    ]
    return sorted(rows, key=lambda row: row["meanAbsShap"], reverse=True)


def _pearson(a: np.ndarray, b: np.ndarray) -> float:
    if np.std(a) == 0 or np.std(b) == 0:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])
