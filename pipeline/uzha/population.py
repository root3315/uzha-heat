"""Who lives in the heat: people per cell (WorldPop) and schools, kindergartens, clinics (OSM).

A light step over a city JSON that already exists: it reads the cells, adds `cells.pop`,
`population` and `facilities`, and writes the file back. No satellite reads, no retraining.
"""
import json
import logging
import math
from pathlib import Path

import numpy as np
from pyproj import Transformer

from .cache import Cache
from .export import COORD_DECIMALS, write_json
from .grid import WGS84, Grid, utm_crs_for
from .sources import osm, worldpop

log = logging.getLogger(__name__)


def grid_of_cells(lon, lat, cell_size: float) -> tuple:
    """The UTM grid the exported cells came from, rebuilt from their centres, and each cell's (row, col).
    The pipeline snaps grids to multiples of the cell size, so the centres pin it down exactly."""
    lon, lat = np.asarray(lon, dtype=float), np.asarray(lat, dtype=float)
    crs = utm_crs_for(float(lon.mean()), float(lat.mean()))
    x, y = Transformer.from_crs(WGS84, crs, always_xy=True).transform(lon, lat)
    left = math.floor(x.min() / cell_size) * cell_size
    right = math.floor(x.max() / cell_size) * cell_size + cell_size
    bottom = math.floor(y.min() / cell_size) * cell_size
    top = math.floor(y.max() / cell_size) * cell_size + cell_size
    grid = Grid(crs=crs, left=left, top=top, rows=round((top - bottom) / cell_size),
                cols=round((right - left) / cell_size), cell_size=cell_size)
    row, col, _ = grid.cell_index(x, y)
    return grid, row, col


def cell_values(per_grid_cell: np.ndarray, row: np.ndarray, col: np.ndarray) -> list:
    """Whole people per exported cell."""
    return [int(v) for v in np.rint(per_grid_cell[row, col])]


def facilities_in_cells(points: list, grid: Grid, occupied: np.ndarray) -> list:
    """Facilities that fall into one of the exported cells, as contract objects."""
    if not points:
        return []
    to_utm = Transformer.from_crs(WGS84, grid.crs, always_xy=True)
    x, y = to_utm.transform([p[2] for p in points], [p[3] for p in points])
    row, col, inside = grid.cell_index(np.asarray(x), np.asarray(y))
    kept = []
    for point, r, c, ok in zip(points, row, col, inside):
        if ok and occupied[r, c]:
            name, kind, lon, lat = point
            kept.append({"name": name, "type": kind, "lon": round(lon, COORD_DECIMALS), "lat": round(lat, COORD_DECIMALS)})
    return sorted(kept, key=lambda f: (f["type"], f["lon"], f["lat"]))


def enrich(document: dict, cache_root: Path) -> dict:
    """Add people per cell and facilities to a city document in place; a failed source is skipped."""
    cells = document["cells"]
    grid, row, col = grid_of_cells(cells["lon"], cells["lat"], float(document["grid"]["cellSizeM"]))
    city_id = document["city"]["id"]
    cache_root = Path(cache_root)

    try:
        people = worldpop.people_per_cell(worldpop.download(cache_root / "worldpop"), grid)
    except Exception:
        log.exception("%s: WorldPop unavailable, no population", city_id)
    else:
        cells["pop"] = cell_values(people, row, col)
        document["population"] = {"source": worldpop.SOURCE_LABEL, "year": worldpop.YEAR, "total": int(sum(cells["pop"]))}

    cache = Cache(cache_root / f"{city_id}_{grid.key()}")
    elements = cache.get_or_compute("osm_facilities", lambda: osm.fetch_facilities(grid.bbox_lonlat()))
    if elements is None:
        log.warning("%s: OSM facilities unavailable, skipping", city_id)
    else:
        occupied = np.zeros(grid.shape, dtype=bool)
        occupied[row, col] = True
        document["facilities"] = facilities_in_cells(osm.facility_points(elements), grid, occupied)
    return document


def enrich_file(path: Path, cache_root: Path) -> dict:
    """Run `enrich` on an exported city JSON and write it back."""
    document = enrich(json.loads(Path(path).read_text(encoding="utf-8")), cache_root)
    write_json(path, document)
    return document
