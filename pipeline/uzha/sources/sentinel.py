"""Summer NDVI and broadband albedo from Sentinel-2 L2A."""
import logging
from collections import defaultdict
from dataclasses import dataclass

import numpy as np
from rasterio.enums import Resampling

from ..grid import Raster
from ..stac import parallel_map, read_to_raster, search

log = logging.getLogger(__name__)

DATES = ["2023-06-01/2023-08-31", "2024-06-01/2024-08-31", "2025-06-01/2025-08-31"]
MAX_SCENE_CLOUD = 10
SCENES_PER_TILE = 10
MIN_SCENE_CLEAR_FRACTION = 0.05

REFLECTANCE_BANDS = ("B02", "B04", "B08", "B11", "B12")
# Scene classification: 2 dark area, 4 vegetation, 5 not vegetated, 6 water, 7 unclassified.
SCL_CLEAR = (2, 4, 5, 6, 7)
BOA_OFFSET_BASELINE = 4.0
BOA_OFFSET_DN = 1000.0
QUANTIFICATION = 10000.0

LIANG_COEFFICIENTS = {"B02": 0.356, "B04": 0.130, "B08": 0.373, "B11": 0.085, "B12": 0.072}
LIANG_INTERCEPT = -0.0018


@dataclass
class SurfaceResult:
    ndvi: np.ndarray
    albedo: np.ndarray
    scenes: int


def to_reflectance(dn: np.ndarray, processing_baseline: str) -> np.ndarray:
    """L2A digital number -> surface reflectance; baseline 04.00+ stores values with a +1000 offset."""
    offset = BOA_OFFSET_DN if float(processing_baseline) >= BOA_OFFSET_BASELINE else 0.0
    return (dn - offset) / QUANTIFICATION


def ndvi(nir: np.ndarray, red: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        value = (nir - red) / (nir + red)
    return np.where(np.isfinite(value), value, np.nan)


def liang_albedo(reflectance: dict) -> np.ndarray:
    """Liang (2001) shortwave broadband albedo from Sentinel-2 reflectances."""
    return sum(weight * reflectance[band] for band, weight in LIANG_COEFFICIENTS.items()) + LIANG_INTERCEPT


def summer_surface(bbox: tuple, raster: Raster) -> SurfaceResult:
    items = _find_scenes(bbox)
    results = [r for r in parallel_map(lambda item: _scene_surface(item, raster), items)
               if np.isfinite(r[0]).mean() >= MIN_SCENE_CLEAR_FRACTION]
    log.info("Sentinel-2: %d items, %d usable", len(items), len(results))
    if not results:
        raise RuntimeError(f"No clear Sentinel-2 scenes for {bbox}")
    with np.errstate(all="ignore"):
        ndvi_median = np.nanmedian(np.stack([r[0] for r in results]), axis=0)
        albedo_median = np.nanmedian(np.stack([r[1] for r in results]), axis=0)
    return SurfaceResult(ndvi_median, albedo_median, len(results))


def _find_scenes(bbox: tuple) -> list:
    query = {"eo:cloud_cover": {"lt": MAX_SCENE_CLOUD}}
    by_tile = defaultdict(dict)
    for dates in DATES:
        for item in search("sentinel-2-l2a", bbox, dates, query):
            # reprocessed products share a datatake; keep one per tile and datatake
            by_tile[item.properties["s2:mgrs_tile"]][item.properties["s2:datatake_id"]] = item
    chosen = []
    for items in by_tile.values():
        chosen.extend(sorted(items.values(), key=_scene_rank)[:SCENES_PER_TILE])
    return chosen


def _scene_rank(item) -> float:
    """Lower is better: items at a swath edge are mostly empty and rarely cover the city."""
    return item.properties["eo:cloud_cover"] + item.properties["s2:nodata_pixel_percentage"]


def _scene_surface(item, raster: Raster) -> tuple:
    baseline = item.properties["s2:processing_baseline"]
    reflectance = {
        band: to_reflectance(read_to_raster(item.assets[band].href, raster, Resampling.bilinear, nodata=0), baseline)
        for band in REFLECTANCE_BANDS
    }
    scl = read_to_raster(item.assets["SCL"].href, raster, Resampling.nearest, nodata=0)
    clear = np.isin(scl, SCL_CLEAR)
    scene_ndvi = np.where(clear, ndvi(reflectance["B08"], reflectance["B04"]), np.nan)
    scene_albedo = np.where(clear, liang_albedo(reflectance), np.nan)
    return scene_ndvi, scene_albedo
