import numpy as np
import pytest
from sklearn.linear_model import LinearRegression

from pipeline.uzha.cv import buffered_folds, out_of_fold, spatial_folds


def _grid(n=20, step=200.0):
    x, y = np.meshgrid(np.arange(n) * step + step / 2, np.arange(n) * step + step / 2)
    return x.ravel(), y.ravel()


def test_spatial_folds_hold_out_whole_blocks():
    x, y = _grid()
    for train, test in spatial_folds(x, y, block_m=1000, folds=5):
        test_blocks = set(zip((x[test] // 1000).astype(int), (y[test] // 1000).astype(int)))
        train_blocks = set(zip((x[train] // 1000).astype(int), (y[train] // 1000).astype(int)))
        assert not test_blocks & train_blocks
        assert len(train) + len(test) == len(x)


def test_buffered_folds_drop_training_cells_near_the_test_cells():
    x, y = _grid()
    for train, test in buffered_folds(x, y, block_m=1000, folds=5, buffer_m=400):
        tx, ty = x[test], y[test]
        for i in train:
            assert np.min(np.hypot(tx - x[i], ty - y[i])) > 400
        assert len(train) + len(test) < len(x)  # something was dropped


def test_out_of_fold_scores_a_perfect_linear_signal():
    x, y = _grid()
    features = np.column_stack([x, y])
    target = 0.01 * x - 0.02 * y + 5
    r2, mae = out_of_fold(lambda: LinearRegression(), features, target, spatial_folds(x, y, 1000, 5))
    assert r2 == pytest.approx(1.0) and mae == pytest.approx(0.0, abs=1e-9)


def test_out_of_fold_with_buffer_scores_only_cells_it_predicted():
    x, y = _grid()
    features = np.column_stack([x])
    target = 0.01 * x
    r2, _ = out_of_fold(lambda: LinearRegression(), features, target, buffered_folds(x, y, 1000, 5, 400))
    assert r2 == pytest.approx(1.0)


def test_cv_check_runs_every_check_on_a_published_city_file(tmp_path):
    import json

    from pipeline.cv_check import check

    rng = np.random.default_rng(0)
    n = 300
    lon, lat = 69.1 + rng.uniform(0, 0.3, n), 41.2 + rng.uniform(0, 0.25, n)  # ~25 km, room for 4 km blocks
    ndvi, built = rng.uniform(0, 0.6, n), rng.uniform(0, 100, n)
    lst = 46 - 10 * ndvi + 0.03 * built + rng.normal(0, 0.3, n)
    city = {"features": [{"key": "ndvi"}, {"key": "built"}],
            "cells": {"lon": lon.tolist(), "lat": lat.tolist(), "lst": lst.tolist(),
                      "values": {"ndvi": ndvi.tolist(), "built": built.tolist()}}}
    (tmp_path / "tashkent.json").write_text(json.dumps(city), encoding="utf-8")
    rows = check("tashkent", tmp_path)
    assert len(rows) == 7 and all(-1 < row["r2"] <= 1 for row in rows)
    linear = next(row for row in rows if row["check"].startswith("Linear, all"))
    assert linear["r2"] > 0.9
