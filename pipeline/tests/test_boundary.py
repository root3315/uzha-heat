import json

import numpy as np
import pytest

from pipeline.uzha import boundary
from pipeline.uzha.cities import City

SQUARE = [[69.2, 41.2], [69.3, 41.2], [69.3, 41.3], [69.2, 41.3], [69.2, 41.2]]
METERS_PER_DEG_LAT = 111_320.0


def _city(city_id="testcity", bbox=(1.0, 2.0, 3.0, 4.0)):
    return City(id=city_id, name="T", name_en="T", country="T", center=(69.25, 41.25), bbox=bbox, wiki_title="T")


def _write_boundary(directory, city_id="testcity"):
    feature = {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [SQUARE]}}
    (directory / f"{city_id}.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [feature]}))


def test_bbox_is_boundary_extent_plus_margin(tmp_path):
    _write_boundary(tmp_path)
    (west, south, east, north), area = boundary.city_extent(_city(), margin_m=1500, directory=tmp_path)
    margin_lat = 1500 / METERS_PER_DEG_LAT
    margin_lon = margin_lat / np.cos(np.radians(41.25))
    assert south == pytest.approx(41.2 - margin_lat, abs=2e-4)
    assert north == pytest.approx(41.3 + margin_lat, abs=2e-4)
    assert west == pytest.approx(69.2 - margin_lon, abs=3e-4)
    assert east == pytest.approx(69.3 + margin_lon, abs=3e-4)
    assert area is not None


def test_missing_boundary_falls_back_to_configured_bbox(tmp_path):
    city = _city(bbox=(69.1, 41.1, 69.4, 41.4))
    bbox, area = boundary.city_extent(city, directory=tmp_path)
    assert bbox == city.bbox
    assert area is None


def test_inside_keeps_cells_within_margin_only(tmp_path):
    _write_boundary(tmp_path)
    _, area = boundary.city_extent(_city(), margin_m=1500, directory=tmp_path)
    lon = np.array([69.25, 69.305, 69.35])  # center, ~400 m outside, ~4 km outside
    lat = np.full(3, 41.25)
    assert boundary.inside(area, lon, lat).tolist() == [True, True, False]
    assert boundary.inside(None, lon, lat).all()


def test_shipped_boundaries_contain_city_centers():
    from shapely.geometry import Point

    from pipeline.uzha.cities import CITIES
    for city in CITIES.values():
        loaded = boundary.load(city.id)
        assert loaded is not None, city.id
        assert loaded.contains(Point(city.center)), city.id
