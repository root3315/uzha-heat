import numpy as np
import pytest

from pipeline.uzha import features
from pipeline.uzha.grid import Grid
from pipeline.uzha.sources import ghsl, osm

F = features.FINE_FACTOR


def _fine(cell_values: list) -> np.ndarray:
    """A 1 x n grid of cells, each filled with its value on the fine raster."""
    return np.repeat(np.repeat(np.array([cell_values], dtype=float), F, axis=0), F, axis=1)


@pytest.mark.parametrize("tags, expected", [
    ({"height": "12"}, 12.0),
    ({"height": "7,5 m"}, 7.5),
    ({"building:levels": "5"}, 15.0),
    ({"height": "tall", "building:levels": "2"}, 6.0),
    ({"height": "0.5"}, None),
    ({"building:levels": "200"}, None),
    ({}, None),
])
def test_tagged_height(tags, expected):
    assert osm.tagged_height(tags) == expected


def test_building_heights_counts_by_centre():
    grid = Grid.from_bbox((69.20, 41.25, 69.21, 41.26), 200)
    lon, lat = grid.cell_centers_lonlat()
    centre = {"lon": float(lon[0, 0]), "lat": float(lat[0, 0])}
    elements = [
        {"center": centre, "tags": {"building": "yes", "building:levels": "4"}},
        {"center": centre, "tags": {"building": "yes"}},
        {"tags": {"building": "yes"}},  # no centre: skipped
    ]
    counts, tagged, total = osm.building_heights(elements, grid)
    assert counts[0, 0] == 2 and tagged[0, 0] == 1 and total[0, 0] == 12.0
    assert counts.sum() == 2


def test_building_form_fills_untagged_buildings_from_ghsl():
    height_fine = _fine([10.0, 10.0, 0.0, 10.0])
    share_fine = _fine([0.5, 0.5, 0.0, np.nan])
    counts = np.array([[0.0, 4.0, 0.0, 0.0]])
    tagged = np.array([[0.0, 2.0, 0.0, 0.0]])
    tagged_sum = np.array([[0.0, 60.0, 0.0, 0.0]])  # two buildings of 30 m in OSM
    height, volume, valid = features.building_form(height_fine, share_fine, counts, tagged, tagged_sum)
    assert height[0, 0] == pytest.approx(10.0)  # no OSM buildings: GHSL
    assert height[0, 1] == pytest.approx((60 + 2 * 10) / 4)  # two from OSM, two filled from GHSL
    assert height[0, 2] == 0.0 and volume[0, 2] == 0.0  # nothing built
    assert np.isnan(height[0, 3]) and valid[0, 3] == 0.0  # outside the GHSL tiles
    assert volume[0, 0] == pytest.approx(0.5 * 10.0 * 10_000)  # m³ per hectare


def test_ghsl_tiles_cover_the_cities():
    assert ghsl.tile_name(69.28, 41.31) == "R5_C25"  # Tashkent
    assert ghsl.tile_name(64.43, 39.77) == "R5_C25"  # Bukhara
    assert ghsl.tiles_for((69.1, 41.1, 69.6, 41.5)) == ["R5_C25"]
    assert ghsl.tiles_for((69.9, 39.0, 70.1, 39.2)) == ["R5_C25", "R5_C26", "R6_C25", "R6_C26"]


def test_pixel_area_shrinks_with_latitude():
    assert ghsl.pixel_area_m2(0) == pytest.approx(92.66 ** 2, rel=0.01)
    assert ghsl.pixel_area_m2(41.3) == pytest.approx(92.66 ** 2 * 0.7513, rel=0.01)
