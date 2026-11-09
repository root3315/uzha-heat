import numpy as np
import pytest

from pipeline.uzha.grid import Grid, aggregate, half_size_deg, utm_crs_for


def test_aggregate_averages_blocks_ignoring_nan():
    fine = np.arange(16, dtype=float).reshape(4, 4)
    fine[0, 0] = np.nan
    mean, valid = aggregate(fine, 2)
    assert mean.shape == (2, 2)
    assert mean[0, 0] == pytest.approx((1 + 4 + 5) / 3)
    assert mean[1, 1] == pytest.approx((10 + 11 + 14 + 15) / 4)
    assert valid[0, 0] == pytest.approx(0.75)
    assert valid[1, 1] == 1.0


def test_aggregate_all_nan_block_is_nan():
    mean, valid = aggregate(np.full((2, 2), np.nan), 2)
    assert np.isnan(mean[0, 0]) and valid[0, 0] == 0.0


def test_utm_zone_from_longitude():
    assert utm_crs_for(69.28, 41.31).to_epsg() == 32642
    assert utm_crs_for(64.42, 39.77).to_epsg() == 32641


def test_grid_snaps_to_cell_size_and_covers_bbox():
    bbox = (69.2, 41.25, 69.3, 41.32)
    grid = Grid.from_bbox(bbox, cell_size=200)
    assert grid.left % 200 == 0 and grid.top % 200 == 0
    west, south, east, north = grid.bbox_lonlat()
    assert west <= bbox[0] and south <= bbox[1] and east >= bbox[2] and north >= bbox[3]
    raster = grid.raster(7)
    assert raster.shape == (grid.rows * 7, grid.cols * 7)
    assert raster.res == pytest.approx(200 / 7)


def test_sum_points_counts_per_cell_and_ignores_outside():
    grid = Grid.from_bbox((69.2, 41.25, 69.21, 41.26), cell_size=200)
    x = np.array([grid.left + 50, grid.left + 150, grid.left + 250, grid.left - 10])
    y = np.full(4, grid.top - 50)
    counts = grid.sum_points(x, y)
    assert counts[0, 0] == 2 and counts[0, 1] == 1 and counts.sum() == 3


def test_half_size_deg_matches_contract_example_at_tashkent():
    lon_half, lat_half = half_size_deg(200, 41.31)
    assert lon_half == pytest.approx(0.0012, abs=1e-4)
    assert lat_half == pytest.approx(0.0009, abs=1e-4)
