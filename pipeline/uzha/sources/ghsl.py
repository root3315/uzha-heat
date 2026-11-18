"""GHSL building height (ANBH 2018) and built-up surface (2020), JRC, 3 arc-second WGS84 tiles."""
import logging
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import rowcol
from rasterio.windows import Window

from ..grid import Raster
from ..stac import GDAL_ENV, mosaic_to_raster
from ..download import download_to

log = logging.getLogger(__name__)

ROOT = "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL"
HEIGHT = "GHS_BUILT_H_ANBH_E2018_GLOBE_R2023A_4326_3ss"
SURFACE = "GHS_BUILT_S_E2020_GLOBE_R2023A_4326_3ss"
PRODUCT_DIRS = {HEIGHT: "GHS_BUILT_H_GLOBE_R2023A", SURFACE: "GHS_BUILT_S_GLOBE_R2023A"}
SOURCE_LABEL = "GHSL Built-H 2018 (ANBH) и Built-S 2020, JRC, 3″ (~90 м)"
PIXEL_DEG = 3 / 3600
#: The 10° tiles are offset by a fraction of a pixel: R1 starts at this latitude, C1 at this longitude.
TILE_TOP = 89.0996
TILE_LEFT = -180.0079
TILE_DEG = 10.0
EARTH_RADIUS_M = 6371008.8
DOWNLOAD_TIMEOUT_S = (30, 600)


def tile_name(lon: float, lat: float) -> str:
    """"R5_C25" for the 10° tile containing the point."""
    row = math.floor((TILE_TOP - lat) / TILE_DEG) + 1
    col = math.floor((lon - TILE_LEFT) / TILE_DEG) + 1
    return f"R{row}_C{col}"


def tiles_for(bbox: tuple) -> list:
    west, south, east, north = bbox
    return sorted({tile_name(lon, lat) for lon in (west, east) for lat in (south, north)})


def download(product: str, tile: str, cache_dir: Path) -> Path:
    """The tile's zip in `cache_dir`, downloaded once (10–60 MB)."""
    name = f"{product}_V1_0_{tile}.zip"
    url = f"{ROOT}/{PRODUCT_DIRS[product]}/{product}/V1-0/tiles/{name}"
    return download_to(url, Path(cache_dir) / name, DOWNLOAD_TIMEOUT_S)


def _read(product: str, bbox: tuple, raster: Raster, cache_dir: Path) -> np.ndarray:
    hrefs = []
    for tile in tiles_for(bbox):
        path = download(product, tile, cache_dir)
        hrefs.append(f"/vsizip/{path.as_posix()}/{path.stem}.tif")
    return mosaic_to_raster(hrefs, raster, Resampling.nearest)


def height_at(lon: np.ndarray, lat: np.ndarray, cache_dir: Path) -> np.ndarray:
    """GHSL building height (m) of the 3″ pixel under each point; NaN outside the tiles."""
    lon, lat = np.asarray(lon, dtype=float), np.asarray(lat, dtype=float)
    out = np.full(lon.shape, np.nan, dtype=np.float32)
    if lon.size == 0:
        return out
    tiles = np.array([tile_name(x, y) for x, y in zip(lon, lat)])
    for tile in np.unique(tiles):
        path = download(HEIGHT, tile, cache_dir)
        here = tiles == tile
        with rasterio.Env(**GDAL_ENV), rasterio.open(f"/vsizip/{path.as_posix()}/{path.stem}.tif") as src:
            rows, cols = rowcol(src.transform, lon[here], lat[here])
            rows, cols = np.asarray(rows), np.asarray(cols)
            window = Window(cols.min(), rows.min(), cols.max() - cols.min() + 1, rows.max() - rows.min() + 1)
            data = src.read(1, window=window).astype(np.float32)
            values = data[rows - rows.min(), cols - cols.min()]
            if src.nodata is not None:
                values[values == src.nodata] = np.nan
        out[here] = values
    return out


def pixel_area_m2(lat: float) -> float:
    """Area of one 3″ pixel at the given latitude, m²."""
    side = math.radians(PIXEL_DEG) * EARTH_RADIUS_M
    return side * side * math.cos(math.radians(lat))


def built(bbox: tuple, raster: Raster, cache_dir: Path) -> tuple:
    """(building height, m; built-up share of the ground, 0–1) on `raster`; NaN outside the tiles.

    Each fine pixel takes the 3″ pixel under it, so a cell's mean is area-weighted.
    """
    height = _read(HEIGHT, bbox, raster, cache_dir)
    surface_m2 = _read(SURFACE, bbox, raster, cache_dir)
    lat = (bbox[1] + bbox[3]) / 2
    share = np.clip(surface_m2 / pixel_area_m2(lat), 0.0, 1.0)
    return height, share.astype(np.float32)
