"""Planetary Computer STAC search and raster reads resampled onto an analysis raster."""
import math
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import planetary_computer
import pystac_client
import rasterio
from affine import Affine
from pystac_client.exceptions import APIError
from rasterio.enums import Resampling
from rasterio.errors import WindowError
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window, from_bounds

from .grid import Raster

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
GDAL_ENV = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "GDAL_HTTP_MAX_RETRY": "5",
    "GDAL_HTTP_RETRY_DELAY": "2",
    "VSI_CACHE": "TRUE",
}
READ_WORKERS = 6
SEARCH_ATTEMPTS = 4
SEARCH_RETRY_DELAY_S = 15


def search(collection: str, bbox: tuple, datetime: str = None, query: dict = None) -> list:
    """STAC item search; retried because the API intermittently answers "Service is unavailable"."""
    for attempt in range(1, SEARCH_ATTEMPTS + 1):
        try:
            catalog = pystac_client.Client.open(STAC_URL, modifier=planetary_computer.sign_inplace)
            found = catalog.search(collections=[collection], bbox=list(bbox), datetime=datetime, query=query)
            return list(found.items())
        except APIError:
            if attempt == SEARCH_ATTEMPTS:
                raise
            time.sleep(SEARCH_RETRY_DELAY_S * attempt)


def read_to_raster(href: str, raster: Raster, resampling: Resampling, nodata=None) -> np.ndarray:
    """Read the part of a COG covering `raster` and reproject it; float32, NaN where no data.

    Fine source data is read through overviews (decimated) when the target is much coarser.
    """
    out = np.full(raster.shape, np.nan, dtype=np.float32)
    with rasterio.Env(**GDAL_ENV), rasterio.open(href) as src:
        src_nodata = src.nodata if nodata is None else nodata
        bounds = transform_bounds(raster.crs, src.crs, *raster.bounds, densify_pts=21)
        try:
            window = (
                from_bounds(*bounds, transform=src.transform)
                .round_offsets(op="floor")
                .round_lengths(op="ceil")
                .intersection(Window(0, 0, src.width, src.height))
            )
        except WindowError:
            return out
        if window.width < 1 or window.height < 1:
            return out
        # source pixels per target pixel; unit-agnostic, so it works for degree-based sources too
        decimation = max(1, int(min(window.width / raster.shape[1], window.height / raster.shape[0])))
        out_shape = (math.ceil(window.height / decimation), math.ceil(window.width / decimation))
        read_resampling = Resampling.nearest if resampling == Resampling.nearest else Resampling.average
        data = src.read(1, window=window, out_shape=out_shape, resampling=read_resampling)
        src_transform = src.window_transform(window) * Affine.scale(
            window.width / out_shape[1], window.height / out_shape[0]
        )
        reproject(
            source=data.astype(np.float32),
            destination=out,
            src_transform=src_transform,
            src_crs=src.crs,
            src_nodata=src_nodata,
            dst_transform=raster.transform,
            dst_crs=raster.crs,
            dst_nodata=np.nan,
            resampling=resampling,
        )
    return out


def mosaic_to_raster(hrefs: list, raster: Raster, resampling: Resampling, nodata=None) -> np.ndarray:
    """First-valid mosaic of several tiles (e.g. DEM or land-cover tiles) onto `raster`."""
    out = np.full(raster.shape, np.nan, dtype=np.float32)
    for layer in parallel_map(lambda href: read_to_raster(href, raster, resampling, nodata), hrefs):
        gap = np.isnan(out)
        out[gap] = layer[gap]
    return out


def parallel_map(func, items: list) -> list:
    with ThreadPoolExecutor(max_workers=READ_WORKERS) as pool:
        return list(pool.map(func, items))
