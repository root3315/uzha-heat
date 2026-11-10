"""WorldPop population counts (100 m, UN-adjusted, constrained to built settlements), summed to cells."""
import logging
from pathlib import Path

import numpy as np
import rasterio
import requests
from pyproj import Transformer
from rasterio.transform import xy
from rasterio.windows import from_bounds

from ..grid import WGS84, Grid

log = logging.getLogger(__name__)

YEAR = 2025
FILE_NAME = f"uzb_pop_{YEAR}_CN_100m_R2025A_v1.tif"
URL = f"https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/{YEAR}/UZB/v1/100m/constrained/{FILE_NAME}"
SOURCE_LABEL = f"WorldPop {YEAR}, 100 м, constrained, R2025A"
DOWNLOAD_TIMEOUT_S = (30, 300)
CHUNK_BYTES = 1 << 20
#: One pixel of margin around the grid, degrees (~100 m), so edge cells get their full count.
MARGIN_DEG = 0.001


def download(cache_dir: Path, url: str = URL) -> Path:
    """The country GeoTIFF in `cache_dir`, downloaded once (about 36 MB)."""
    path = Path(cache_dir) / FILE_NAME
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".part")
    log.info("downloading %s", url)
    with requests.get(url, stream=True, timeout=DOWNLOAD_TIMEOUT_S) as response:
        response.raise_for_status()
        with partial.open("wb") as f:
            for chunk in response.iter_content(CHUNK_BYTES):
                f.write(chunk)
    partial.replace(path)
    return path


def people_per_cell(path: Path, grid: Grid) -> np.ndarray:
    """People in each grid cell: every WorldPop pixel inside the grid's extent adds its count to the
    cell under its centre. A 100 m pixel is about a quarter of a 200 m cell, so the city total is kept
    exactly and a pixel on a cell edge goes to one of the two cells, not split."""
    west, south, east, north = grid.bbox_lonlat()
    with rasterio.open(path) as src:
        window = from_bounds(west - MARGIN_DEG, south - MARGIN_DEG, east + MARGIN_DEG, north + MARGIN_DEG, src.transform)
        window = window.round_offsets().round_lengths()
        counts = src.read(1, window=window, boundless=True, fill_value=0, masked=True).filled(0).astype(float)
        transform = src.window_transform(window)
    counts[~np.isfinite(counts) | (counts < 0)] = 0
    rows, cols = np.nonzero(counts)
    if len(rows) == 0:
        return np.zeros(grid.shape)
    lon, lat = xy(transform, rows, cols)
    x, y = Transformer.from_crs(WGS84, grid.crs, always_xy=True).transform(np.asarray(lon), np.asarray(lat))
    return grid.sum_points(x, y, counts[rows, cols])
