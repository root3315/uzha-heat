import numpy as np
import pytest
from affine import Affine
from shapely.geometry import box

from pipeline.uzha.sources.landsat import PERIODS
from pipeline.uzha.sources.modis import PIXEL_M, good_quality, in_period, median_with_min_count, modis_raster
from pipeline.uzha.validation import (agreement, aggregate_to_pixels, heat_island, outline_position, pixel_centers,
                                      ring_mask)

UNIT = Affine(10.0, 0.0, 0.0, 0.0, -10.0, 20.0)  # 2x2 pixels of 10 m, top-left at (0, 20)


def test_aggregate_to_pixels_means_points_per_pixel_and_skips_nan_and_outside():
    x = np.array([1.0, 9.0, 15.0, 5.0, 5.0, 50.0])
    y = np.array([19.0, 11.0, 15.0, 5.0, 5.0, 5.0])
    values = np.array([10.0, 20.0, 7.0, 3.0, np.nan, 99.0])
    mean, count = aggregate_to_pixels(x, y, values, UNIT, (2, 2))
    assert mean[0, 0] == pytest.approx(15.0) and count[0, 0] == 2
    assert mean[0, 1] == pytest.approx(7.0) and count[0, 1] == 1
    assert mean[1, 0] == pytest.approx(3.0) and count[1, 0] == 1
    assert np.isnan(mean[1, 1]) and count[1, 1] == 0


def test_pixel_centers():
    x, y = pixel_centers(UNIT, (2, 2))
    assert x[0, 0] == 5.0 and y[0, 0] == 15.0
    assert x[1, 1] == 15.0 and y[1, 1] == 5.0


def test_ring_mask_keeps_outside_points_within_width():
    outline = box(0, 0, 100, 100)
    x = np.array([50.0, 120.0, 140.0, 200.0])
    y = np.array([50.0, 50.0, 50.0, 50.0])
    inside, distance = outline_position(outline, x, y)
    assert inside.tolist() == [True, False, False, False]
    assert distance.tolist() == pytest.approx([0.0, 20.0, 40.0, 100.0])
    assert ring_mask(inside, distance, 40.0).tolist() == [False, True, True, False]
    assert ring_mask(inside, distance, 10.0).tolist() == [False, False, False, False]


def test_heat_island_is_median_difference_and_needs_enough_samples():
    values = np.r_[np.full(30, 40.0), np.full(30, 37.0), [np.nan]]
    inside = np.r_[np.ones(30, bool), np.zeros(31, bool)]
    ring = ~inside
    result = heat_island(values, inside, ring)
    assert result["intensity"] == pytest.approx(3.0)
    assert result["insideCount"] == 30 and result["outsideCount"] == 30
    assert heat_island(values, inside, ring, min_samples=31) is None


def test_agreement_bias_rmse_and_r():
    reference = np.array([30.0, 32.0, 34.0, np.nan])
    ours = np.array([31.0, 33.0, 35.0, 40.0])
    stats = agreement(ours, reference)
    assert stats["n"] == 3
    assert stats["bias"] == pytest.approx(1.0)
    assert stats["rmse"] == pytest.approx(1.0)
    assert stats["r"] == pytest.approx(1.0)


def test_good_quality_bits():
    # 0 good; 17 other quality, LST error <= 1 K; 81 other, <= 2 K; 145 other, <= 3 K;
    # 2 not produced (cloud); 3 not produced; nan missing
    qc = np.array([0, 17, 81, 145, 2, 3, np.nan])
    assert good_quality(qc).tolist() == [True, True, True, False, False, False, False]


def test_median_with_min_count():
    stack = np.array([[1.0, np.nan], [3.0, np.nan], [5.0, 2.0]])
    median, count = median_with_min_count(stack, 2)
    assert median[0] == pytest.approx(3.0) and np.isnan(median[1])
    assert count.tolist() == [3, 1]


def test_in_period_uses_composite_middle_day():
    summer = PERIODS[0]
    assert not in_period("2023-05-25T00:00:00Z", summer)
    assert in_period("2023-06-02T00:00:00Z", summer)
    assert in_period("2023-08-21T00:00:00Z", summer)
    assert not in_period("2023-08-29T00:00:00Z", summer)
    assert not in_period("2022-07-01T00:00:00Z", summer)


def test_modis_raster_snaps_to_global_grid():
    raster = modis_raster((69.1, 41.14, 69.55, 41.44))
    tile_h23_left = 5559752.598833
    offset = (raster.transform.c - tile_h23_left) / PIXEL_M
    assert offset == pytest.approx(round(offset), abs=1e-4)  # mm-level float noise
    assert raster.res == pytest.approx(926.625433, abs=1e-5)


def test_period_of_matches_the_published_landsat_period():
    from pipeline.validate import period_of
    from pipeline.uzha.sources.landsat import PERIODS
    assert period_of({"period": {"label": PERIODS[1].label}}) is PERIODS[1]
    with pytest.raises(ValueError):
        period_of({"period": {"label": "зима"}})


def test_rounded_turns_nan_into_none():
    from pipeline.validate import _rounded
    assert _rounded({"n": 2, "r": float("nan"), "bias": 0.123}) == {"n": 2, "r": None, "bias": 0.12}
