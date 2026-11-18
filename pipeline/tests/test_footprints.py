from types import SimpleNamespace

import numpy as np
import pyogrio
import pytest
import shapely

from pipeline.uzha import footprints
from pipeline.uzha.grid import WGS84, utm_crs_for
from pipeline.uzha.sources import msbuildings, osmpbf


def test_polygons_split_multipolygons_and_drop_lines():
    two = shapely.MultiPolygon([shapely.box(0, 0, 1, 1), shapely.box(2, 0, 3, 1)])
    parts, index = footprints.polygons(np.array([two, shapely.box(5, 5, 6, 6), shapely.LineString([(0, 0), (1, 1)])]))
    assert len(parts) == 3 and index.tolist() == [0, 0, 1]


def test_microsoft_footprints_already_in_osm_are_dropped():
    osm = np.array([shapely.box(0, 0, 10, 10)])
    ms = np.array([
        shapely.box(1, 1, 9, 9),  # the same building, traced again
        shapely.box(9.5, 0, 19.5, 10),  # the neighbour, touching by a 5 % sliver
        shapely.box(30, 30, 40, 40),  # missing from OSM
    ])
    assert footprints.without_overlap(ms, osm).tolist() == [False, True, True]
    assert footprints.without_overlap(ms, np.empty(0, dtype=object)).all()


def test_inside_keeps_buildings_by_centroid():
    area = shapely.box(0, 0, 10, 10)
    shapes = np.array([shapely.box(8, 8, 11, 11), shapely.box(9, 9, 13, 13)])
    assert footprints.inside(shapes, area).tolist() == [True, False]
    assert footprints.inside(shapes, None).all()


def test_simplify_drops_tiny_bends_only():
    wobbly = shapely.Polygon([(0, 0), (10, 0.1), (20, 0), (20, 10), (0, 10)])
    notched = shapely.Polygon([(0, 0), (10, 0), (10, 3), (12, 3), (12, 0), (20, 0), (20, 10), (0, 10)])
    simple = footprints.simplify(np.array([wobbly, notched]))
    assert shapely.get_num_coordinates(simple).tolist() == [5, 9]


def test_to_crs_round_trips():
    crs = utm_crs_for(66.97, 39.65)
    square = np.array([shapely.box(66.97, 39.65, 66.971, 39.651)])
    there = footprints.to_crs(square, WGS84, crs)
    assert 80 < np.sqrt(shapely.area(there[0])) < 100
    back = footprints.to_crs(there, crs, WGS84)
    assert shapely.equals_exact(back[0], square[0], tolerance=1e-9)


def test_heights_are_rounded_to_half_a_metre():
    assert footprints.rounded_height([3.2, 3.3, 12.74]).tolist() == [3.0, 3.5, 12.5]


def test_write_fgb_keeps_the_properties(tmp_path):
    path = tmp_path / "city.fgb"
    shapes = np.array([shapely.box(66.97, 39.65, 66.9701, 39.6501), shapely.box(66.98, 39.66, 66.9801, 39.6601)])
    footprints.write_fgb(path, shapes, np.array([12.3, 4.0]), np.array([1.0, 0.4567]), np.array([True, False]))
    _, _, geometry, fields = pyogrio.raw.read(path)
    assert len(geometry) == 2
    by_height = sorted(zip(*fields))
    assert by_height[0][0] == 4.0 and by_height[0][1] == pytest.approx(0.46) and by_height[0][2] == footprints.SOURCE_MODEL
    assert by_height[1][0] == 12.5 and by_height[1][2] == footprints.SOURCE_TAGGED


def _item(href: str):
    return SimpleNamespace(assets={"data": SimpleNamespace(href=href)})


def test_ms_partitions_take_the_newest_delta_release():
    items = [
        _item("abfs://footprints/global/2022-07-06/ml-buildings.parquet/RegionName=Uzbekistan"),
        _item("abfs://footprints/delta/2023-04-25/ml-buildings.parquet/RegionName=Uzbekistan/quadkey=123011131"),
        _item("abfs://footprints/delta/2023-04-25/ml-buildings.parquet/RegionName=Kazakhstan/quadkey=121322232/"),
        _item("abfs://footprints/delta/2022-11-01/ml-buildings.parquet/RegionName=Uzbekistan/quadkey=123011131"),
    ]
    assert msbuildings.partitions(items) == [
        ("footprints", "delta/2023-04-25/ml-buildings.parquet/RegionName=Kazakhstan/quadkey=121322232"),
        ("footprints", "delta/2023-04-25/ml-buildings.parquet/RegionName=Uzbekistan/quadkey=123011131"),
    ]
    assert msbuildings.partitions([_item("abfs://footprints/global/2022-07-06/x/RegionName=Asia")]) == []


def test_osm_other_tags_are_parsed():
    tags = osmpbf.other_tags('"building:levels"=>"5","height"=>"16 m","name"=>"Дом \\"Ы\\""')
    assert tags["building:levels"] == "5" and tags["height"] == "16 m"
    assert osmpbf.other_tags(None) == {}
