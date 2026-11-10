import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from pipeline.uzha import population
from pipeline.uzha.grid import Grid
from pipeline.uzha.sources import osm, worldpop

BBOX = (69.20, 41.25, 69.23, 41.27)


def _cells(grid: Grid, keep=None):
    lon, lat = grid.cell_centers_lonlat()
    lon, lat = np.round(lon.ravel(), 5), np.round(lat.ravel(), 5)
    keep = np.arange(len(lon)) if keep is None else np.asarray(keep)
    return lon[keep], lat[keep]


def test_grid_of_cells_recovers_the_export_grid():
    grid = Grid.from_bbox(BBOX, 200)
    keep = np.arange(3, grid.rows * grid.cols - 5, 2)  # a ragged subset, like the filtered export
    lon, lat = _cells(grid, keep)
    rebuilt, row, col = population.grid_of_cells(lon, lat, 200.0)
    expected_row, expected_col = np.divmod(keep, grid.cols)
    offset_row = round((grid.top - rebuilt.top) / 200)
    offset_col = round((rebuilt.left - grid.left) / 200)
    assert rebuilt.crs == grid.crs
    np.testing.assert_array_equal(row - offset_row, expected_row)
    np.testing.assert_array_equal(col + offset_col, expected_col)
    assert len(set(zip(row, col))) == len(keep)


def _write_population(path, counts, west=69.19, north=41.28, res=1 / 1200):
    with rasterio.open(path, "w", driver="GTiff", height=counts.shape[0], width=counts.shape[1], count=1,
                       dtype="float32", crs="EPSG:4326", transform=from_origin(west, north, res, res),
                       nodata=-99999.0) as dst:
        dst.write(counts.astype("float32"), 1)


def test_people_per_cell_keeps_the_total_and_ignores_nodata(tmp_path):
    rng = np.random.default_rng(1)
    counts = rng.uniform(0, 50, size=(60, 60))
    counts[:5, :5] = -99999.0  # nodata in a corner, outside the grid anyway
    counts[30, 30] = -99999.0
    path = tmp_path / "pop.tif"
    _write_population(path, counts)
    grid = Grid.from_bbox(BBOX, 200)
    people = worldpop.people_per_cell(path, grid)
    assert people.shape == grid.shape
    assert (people >= 0).all()
    # Every valid pixel whose centre lies in the grid lands in exactly one cell.
    assert people.sum() > 0
    assert people.sum() <= counts[counts > 0].sum()
    per_cell = people[people > 0]
    assert per_cell.mean() == pytest.approx(25 * 200 * 200 / (92.6 * 69.7), rel=0.25)


def test_facility_points_reads_nodes_and_centres():
    elements = [
        {"type": "node", "lon": 69.21, "lat": 41.26, "tags": {"amenity": "school", "name": "Школа № 5"}},
        {"type": "way", "center": {"lon": 69.22, "lat": 41.261}, "tags": {"amenity": "hospital", "name:ru": "Больница", "name": "Kasalxona"}},
        {"type": "way", "center": {"lon": 69.2, "lat": 41.2}, "tags": {"amenity": "kindergarten"}},
        {"type": "node", "lon": 69.2, "lat": 41.2, "tags": {"amenity": "cafe", "name": "Кафе"}},
        {"type": "relation", "tags": {"amenity": "clinic"}},
    ]
    assert osm.facility_points(elements) == [
        ("Школа № 5", "school", 69.21, 41.26),
        ("Больница", "hospital", 69.22, 41.261),
        ("", "kindergarten", 69.2, 41.2),
    ]


def test_enrich_adds_population_and_facilities_in_cells(tmp_path, monkeypatch):
    grid = Grid.from_bbox(BBOX, 200)
    lon, lat = _cells(grid)
    document = {"city": {"id": "test"}, "grid": {"cellSizeM": 200}, "cells": {"lon": lon.tolist(), "lat": lat.tolist()}}
    rebuilt, row, col = population.grid_of_cells(lon, lat, 200.0)
    people = np.zeros(rebuilt.shape)
    people[row[0], col[0]] = 120.4
    people[row[1], col[1]] = 7.6
    monkeypatch.setattr(worldpop, "download", lambda directory: tmp_path / "unused.tif")
    monkeypatch.setattr(worldpop, "people_per_cell", lambda path, g: people)
    inside = {"type": "node", "lon": float(lon[2]), "lat": float(lat[2]), "tags": {"amenity": "clinic", "name": "Поликлиника"}}
    outside = {"type": "node", "lon": 70.5, "lat": 41.26, "tags": {"amenity": "school"}}
    monkeypatch.setattr(osm, "fetch_facilities", lambda bbox: [inside, outside])

    population.enrich(document, tmp_path)

    assert document["cells"]["pop"][:3] == [120, 8, 0]
    assert len(document["cells"]["pop"]) == len(lon)
    assert document["population"]["total"] == 128
    assert document["population"]["year"] == worldpop.YEAR
    assert document["facilities"] == [{"name": "Поликлиника", "type": "clinic", "lon": float(lon[2]), "lat": float(lat[2])}]


def test_enrich_skips_a_failed_source(tmp_path, monkeypatch):
    grid = Grid.from_bbox(BBOX, 200)
    lon, lat = _cells(grid)
    document = {"city": {"id": "test"}, "grid": {"cellSizeM": 200}, "cells": {"lon": lon.tolist(), "lat": lat.tolist()}}

    def offline(directory):
        raise OSError("offline")

    monkeypatch.setattr(worldpop, "download", offline)
    monkeypatch.setattr(osm, "fetch_facilities", lambda bbox: None)
    population.enrich(document, tmp_path)
    assert "pop" not in document["cells"] and "population" not in document and "facilities" not in document
