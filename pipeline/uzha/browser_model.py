"""The fitted XGBoost booster as a compact JSON the web app evaluates in the browser ("что если").

Each tree is four parallel arrays over its nodes:
  feature      split feature index into `features`, −1 for a leaf
  value        split threshold (go left when x < value), or the leaf value
  left         index of the left child (the right one is left + 1), −1 for a leaf
  defaultLeft  1 when a missing value goes left
Numbers are float32, written in their shortest round-trip form, so the browser compares and sums
exactly what XGBoost does. `check` holds a few rows with the booster's own predictions.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

FORMAT = "uzha-xgb-1"
CHECK_ROWS = 12


def _f32(value: float) -> float:
    """Shortest decimal that reads back as the same float32."""
    return float(str(np.float32(value)))


def _base_score(learner: dict) -> float:
    raw = str(learner["learner_model_param"]["base_score"]).strip("[]")
    return _f32(float(raw))


def _tree(tree: dict) -> dict:
    left = tree["left_children"]
    right = tree["right_children"]
    for node, (lo, hi) in enumerate(zip(left, right)):
        if lo != -1 and hi != lo + 1:
            raise ValueError(f"node {node}: right child {hi} is not left + 1 ({lo})")
    leaf = [lo == -1 for lo in left]
    return {
        "feature": [-1 if is_leaf else int(f) for is_leaf, f in zip(leaf, tree["split_indices"])],
        "value": [_f32(v) for v in tree["split_conditions"]],
        "left": [int(lo) for lo in left],
        "defaultLeft": [0 if is_leaf else int(d) for is_leaf, d in zip(leaf, tree["default_left"])],
    }


def slim(booster: xgb.Booster, features: list) -> dict:
    """The booster's trees and base score, nothing else."""
    learner = json.loads(booster.save_raw("json"))["learner"]
    if learner["objective"]["name"] != "reg:squarederror":
        raise ValueError(f"only reg:squarederror is supported, got {learner['objective']['name']}")
    trees = learner["gradient_booster"]["model"]["trees"]
    return {
        "format": FORMAT,
        "features": list(features),
        "baseScore": _base_score(learner),
        "trees": [_tree(tree) for tree in trees],
    }


def predict(model: dict, rows: np.ndarray) -> np.ndarray:
    """Reference evaluator, the same walk the web app does (web/src/domain/whatIf.ts)."""
    rows = np.asarray(rows, dtype=np.float32)
    # XGBoost adds the trees up in float32; summed in float64 the result drifts by up to ~1e-4 over 400 trees.
    out = np.full(len(rows), model["baseScore"], dtype=np.float32)
    for tree in model["trees"]:
        feature = tree["feature"]
        value = np.asarray(tree["value"], dtype=np.float32)
        left = tree["left"]
        default_left = tree["defaultLeft"]
        for r, row in enumerate(rows):
            node = 0
            while feature[node] >= 0:
                x = row[feature[node]]
                go_left = bool(default_left[node]) if np.isnan(x) else x < value[node]
                node = left[node] if go_left else left[node] + 1
            out[r] = np.float32(out[r] + value[node])
    return out.astype(np.float64)


def sample_rows(features: pd.DataFrame, count: int = CHECK_ROWS, seed: int = 0) -> pd.DataFrame:
    """A few cells spread over the temperature range, for the browser-side check."""
    rng = np.random.default_rng(seed)
    picked = rng.choice(len(features), size=min(count, len(features)), replace=False)
    return features.iloc[np.sort(picked)]


def document(booster: xgb.Booster, features: pd.DataFrame) -> dict:
    """Slim model plus `check`: sample rows and the booster's predictions for them."""
    model = slim(booster, list(features.columns))
    rows = sample_rows(features)
    expected = booster.predict(xgb.DMatrix(rows))
    model["check"] = {
        "rows": [[_f32(v) for v in row] for row in rows.to_numpy()],
        "prediction": [round(float(p), 6) for p in expected],
    }
    return model


def write(path: Path, model: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(model, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def refit_from_city_file(path: Path) -> tuple:
    """Refit the final model on the cell table already in `<id>.json` (same params and seed) and slim it.

    For when the raw downloads are no longer cached. Values in the JSON are rounded to 3 decimals, so the refit
    can differ slightly from the published SHAP; returns (model document, max and mean |refit − published|, °C),
    published = baseValue + ΣSHAP per cell.
    """
    from .model import fit_booster

    city = json.loads(Path(path).read_text(encoding="utf-8"))
    keys = [feature["key"] for feature in city["features"]]
    features = pd.DataFrame({key: city["cells"]["values"][key] for key in keys})
    booster = fit_booster(features, np.asarray(city["cells"]["lst"], dtype=float))
    published = city["model"]["baseValue"] + sum(np.asarray(city["cells"]["shap"][key]) for key in keys)
    gap = np.abs(booster.predict(xgb.DMatrix(features)) - published)
    return document(booster, features), float(gap.max()), float(gap.mean())
