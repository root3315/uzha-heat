"""ESA WorldCover 2021 land-cover classes (10 m)."""
import numpy as np
from rasterio.enums import Resampling

from ..grid import Raster
from ..stac import mosaic_to_raster, search

TREE = 10
BUILT = 50
BARE = 60
WATER = 80
NO_DATA = 0


def land_cover(bbox: tuple, raster: Raster) -> np.ndarray:
    """Class codes on `raster` as uint8 (0 = no data)."""
    items = search("esa-worldcover", bbox, "2021-01-01/2021-12-31")
    if not items:
        raise RuntimeError(f"No WorldCover 2021 tiles for {bbox}")
    codes = mosaic_to_raster([item.assets["map"].href for item in items], raster, Resampling.nearest, nodata=NO_DATA)
    return np.nan_to_num(codes, nan=NO_DATA).astype(np.uint8)


def class_share(classes: np.ndarray, code: int) -> np.ndarray:
    """1.0 where the pixel is `code`, 0.0 elsewhere, NaN where land cover is unknown."""
    return np.where(classes != NO_DATA, (classes == code).astype(np.float32), np.nan)
