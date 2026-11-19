"""Spatial cross-validation variants for checking how far the model's skill can be trusted.

The pipeline's own score holds out whole 2 km blocks (model.cross_validate). These helpers vary that design: other
block sizes, a buffer that drops training cells next to the held-out ones (so a neighbour cannot pass on its
temperature), and any estimator, so simple baselines are scored the same way.
"""
from typing import Callable, Iterator

import numpy as np
from scipy.spatial import cKDTree
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import GroupKFold

from .model import spatial_blocks


def spatial_folds(x: np.ndarray, y: np.ndarray, block_m: float, folds: int) -> Iterator[tuple]:
    """(train, test) index pairs holding out whole square blocks of `block_m` metres."""
    groups = spatial_blocks(x, y, block_m)
    yield from GroupKFold(n_splits=folds).split(np.zeros(len(x)), groups=groups)


def buffered_folds(x: np.ndarray, y: np.ndarray, block_m: float, folds: int, buffer_m: float) -> Iterator[tuple]:
    """As `spatial_folds`, with training cells within `buffer_m` of any held-out cell dropped."""
    points = np.column_stack([x, y])
    for train, test in spatial_folds(x, y, block_m, folds):
        # The tree's bound is strict; a cell exactly `buffer_m` away is within the buffer too.
        near = cKDTree(points[test]).query(points[train], distance_upper_bound=buffer_m * (1 + 1e-9))[0]
        yield train[~np.isfinite(near)], test


def out_of_fold(make_model: Callable, features: np.ndarray, target: np.ndarray, folds: Iterator[tuple]) -> tuple:
    """(R², MAE) of predictions each made by a model that never saw the cell's fold."""
    features, target = np.asarray(features), np.asarray(target, float)
    predicted = np.full(len(target), np.nan)
    for train, test in folds:
        predicted[test] = make_model().fit(features[train], target[train]).predict(features[test])
    done = np.isfinite(predicted)
    return float(r2_score(target[done], predicted[done])), float(mean_absolute_error(target[done], predicted[done]))
