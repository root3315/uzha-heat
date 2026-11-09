"""Copernicus DEM GLO-30 elevation."""
import numpy as np
from rasterio.enums import Resampling

from ..grid import Raster
from ..stac import mosaic_to_raster, search


def elevation(bbox: tuple, raster: Raster) -> np.ndarray:
    items = search("cop-dem-glo-30", bbox)
    if not items:
        raise RuntimeError(f"No Copernicus DEM tiles for {bbox}")
    return mosaic_to_raster([item.assets["data"].href for item in items], raster, Resampling.bilinear)
