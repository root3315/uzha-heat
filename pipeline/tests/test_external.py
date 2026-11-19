import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from pipeline.uzha.external import (cells_for_points, compare, compare_by_pixel, raster_to_cells, read_points_csv,
                                    to_celsius)

# A 3 x 3 block of 200 m cells near Tashkent; centres 0.0024° apart in lon, 0.0018° in lat.
HALF = (0.0012, 0.0009)
LON0, LAT0 = 69.25, 41.30
CELL_LON = np.array([LON0 + 0.0024 * c for r in range(3) for c in range(3)])
CELL_LAT = np.array([LAT0 - 0.0018 * r for r in range(3) for c in range(3)])


def test_read_points_csv_finds_coordinate_columns_and_the_one_numeric_value(tmp_path):
    path = tmp_path / "stations.csv"
    path.write_text("Name,Latitude,Longitude,T_air\nA,41.30,69.25,31.5\nB,41.2982,69.2524,33.0\n", encoding="utf-8")
    points = read_points_csv(path)
    assert points.lon.tolist() == [69.25, 69.2524]
    assert points.lat.tolist() == [41.30, 41.2982]
    assert points.value.tolist() == [31.5, 33.0]
    assert points.names == ["A", "B"]
    assert points.value_column == "T_air"


def test_read_points_csv_takes_semicolons_and_decimal_commas(tmp_path):
    path = tmp_path / "points.csv"
    path.write_text("lon;lat;lst\n69,25;41,30;44,5\n", encoding="utf-8")
    points = read_points_csv(path)
    assert points.value.tolist() == [44.5]


def test_read_points_csv_asks_for_a_column_when_the_value_is_ambiguous(tmp_path):
    path = tmp_path / "points.csv"
    path.write_text("lon,lat,t_min,t_max\n69.25,41.30,25,38\n", encoding="utf-8")
    with pytest.raises(ValueError, match="t_min, t_max"):
        read_points_csv(path)
    assert read_points_csv(path, value_column="t_max").value.tolist() == [38.0]


def test_cells_for_points_matches_the_cell_a_point_falls_in_and_skips_far_ones():
    plon = np.array([LON0 + 0.0011, LON0 + 0.0024 * 2, LON0 + 0.05])
    plat = np.array([LAT0 - 0.0008, LAT0 - 0.0018 * 2, LAT0])
    assert cells_for_points(CELL_LON, CELL_LAT, HALF, plon, plat).tolist() == [0, 8, -1]


def test_to_celsius_converts_kelvin_and_leaves_celsius_alone():
    values, converted = to_celsius(np.array([300.15, 310.15]))
    assert converted and values == pytest.approx([27.0, 37.0])
    values, converted = to_celsius(np.array([31.0, 42.0]))
    assert not converted and values.tolist() == [31.0, 42.0]


def _write_raster(path, data, transform, crs="EPSG:4326", nodata=-9999.0):
    with rasterio.open(path, "w", driver="GTiff", height=data.shape[0], width=data.shape[1], count=1,
                       dtype="float32", crs=crs, transform=transform, nodata=nodata) as dst:
        dst.write(data.astype("float32"), 1)


def test_raster_finer_than_cells_is_averaged_per_cell(tmp_path):
    # 0.0006° pixels: 4 across a cell in lon, 3 in lat; the top-left cell gets 40, the rest 30, one pixel nodata.
    width, height = 12, 9
    data = np.full((height, width), 30.0)
    data[0:3, 0:4] = 40.0
    data[8, 11] = -9999.0
    transform = from_origin(LON0 - 0.0012, LAT0 + 0.0009, 0.0006, 0.0006)
    path = tmp_path / "fine.tif"
    _write_raster(path, data, transform)
    values = raster_to_cells(path, CELL_LON, CELL_LAT, HALF)
    assert values[0] == pytest.approx(40.0)
    assert values[4] == pytest.approx(30.0)
    assert np.isfinite(values).all()


def test_raster_coarser_than_cells_is_sampled_at_cell_centres_in_its_own_crs(tmp_path):
    # One 1 km pixel in UTM 42N covering the whole block, value 300 K.
    from pyproj import Transformer
    x, y = Transformer.from_crs("EPSG:4326", "EPSG:32642", always_xy=True).transform(LON0 + 0.0024, LAT0 - 0.0018)
    transform = from_origin(x - 500, y + 500, 1000, 1000)
    path = tmp_path / "coarse.tif"
    _write_raster(path, np.array([[300.0]]), transform, crs="EPSG:32642")
    values, pixel = raster_to_cells(path, CELL_LON, CELL_LAT, HALF, with_pixels=True)
    assert values == pytest.approx(np.full(9, 300.0))
    assert (pixel == pixel[0]).all() and pixel[0] >= 0


def test_compare_by_pixel_averages_our_cells_inside_each_coarse_pixel():
    ours = np.array([40.0, 42.0, 44.0, 30.0, 31.0, 32.0, 20.0, 21.0, 22.0, 50.0])
    theirs = np.array([42.0, 42.0, 42.0, 31.0, 31.0, 31.0, 21.0, 21.0, 21.0, np.nan])
    pixel = np.array([0, 0, 0, 1, 1, 1, 2, 2, 2, -1])
    report = compare_by_pixel(ours, theirs, pixel)
    assert report["n"] == 3 and report["rmse"] == pytest.approx(0.0) and report["r"] == pytest.approx(1.0)


def test_compare_reports_agreement_rank_and_hottest_tenth_overlap():
    rng = np.random.default_rng(0)
    ours = rng.normal(44, 3, 500)
    theirs = ours - 10 + rng.normal(0, 0.5, 500)  # air: cooler, same pattern
    report = compare(ours, theirs)
    assert report["n"] == 500
    assert report["r"] > 0.95 and report["spearman"] > 0.95
    assert report["bias"] == pytest.approx(10, abs=0.2)
    assert report["hottestTenthOverlap"] > 0.7


def test_compare_needs_a_few_pairs():
    report = compare(np.array([40.0, np.nan]), np.array([np.nan, 30.0]))
    assert report["n"] == 0 and report["r"] is None and report["hottestTenthOverlap"] is None


def test_compare_command_reads_a_city_file_and_matches_points(tmp_path):
    import json

    from pipeline.compare import run

    city = {"grid": {"halfSizeDeg": list(HALF)},
            "cells": {"lon": CELL_LON.tolist(), "lat": CELL_LAT.tolist(), "lst": [40.0 + i for i in range(9)]}}
    (tmp_path / "tashkent.json").write_text(json.dumps(city), encoding="utf-8")
    csv_path = tmp_path / "stations.csv"
    rows = "\n".join(f"S{i},{CELL_LON[i]:.5f},{CELL_LAT[i]:.5f},{30.0 + i}" for i in range(9))
    csv_path.write_text("name,lon,lat,t_air\n" + rows + "\nfar,70.5,42.0,25\n", encoding="utf-8")
    report = run("tashkent", csv_path, None, None, 1.0, 0.0, tmp_path)
    assert report["points"] == 10 and report["onTheMap"] == 9
    assert report["r"] == pytest.approx(1.0) and report["bias"] == pytest.approx(10.0)
    assert report["rows"][-1] == {"name": "far", "theirs": 25.0, "ours": None}
