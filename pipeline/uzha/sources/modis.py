"""Summer land-surface temperature from MODIS MOD11A2 (Terra) / MYD11A2 (Aqua), 8-day 1 km composites.

Used only as an external check of the Landsat LST, so values stay on the native MODIS sinusoidal
grid (no resampling): the target raster is snapped to the global 1 km MODIS pixel grid.
"""
import logging
import math
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np
from affine import Affine
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.warp import transform_bounds

from ..grid import WGS84, Raster
from ..stac import parallel_map, read_to_raster, search
from .landsat import KELVIN, Period, period_ranges

log = logging.getLogger(__name__)

COLLECTION = "modis-11A2-061"
SINUSOIDAL = CRS.from_proj4("+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +R=6371007.181 +units=m +no_defs")
GRID_X0 = -20015109.355798
GRID_Y0 = 10007554.677899
TILE_M = 1111950.519667
PIXEL_M = TILE_M / 1200

LST_SCALE = 0.02
LST_FILL = 0
QC_MANDATORY_MASK = 0b11  # bits 0-1: 00 good, 01 produced but "other quality", 1x not produced
QC_OTHER = 0b01
QC_DATA_QUALITY_SHIFT, QC_LST_ERROR_SHIFT = 2, 6  # bits 2-3: 00 good data; bits 6-7: LST error 00 <=1 K, 01 <=2 K
MAX_LST_ERROR_CLASS = 1  # accept average LST error <= 2 K
MIN_COMPOSITES = 5
COMPOSITE_DAYS = 8

PLATFORMS = {"terra": "MOD11A2", "aqua": "MYD11A2"}
OVERPASS_LOCAL = {"terra": {"day": "~10:30", "night": "~22:30"}, "aqua": {"day": "~13:30", "night": "~01:30"}}
BANDS = {"day": ("LST_Day_1km", "QC_Day"), "night": ("LST_Night_1km", "QC_Night")}


@dataclass
class ModisLst:
    raster: Raster  # MODIS sinusoidal 1 km grid
    day: np.ndarray  # °C, NaN where fewer than MIN_COMPOSITES good composites
    night: np.ndarray
    day_count: np.ndarray  # good composites per pixel
    night_count: np.ndarray
    composites: int  # 8-day periods found


def modis_raster(bbox_lonlat: tuple) -> Raster:
    """The part of the global MODIS 1 km grid covering a lon/lat bbox."""
    left, bottom, right, top = transform_bounds(WGS84, SINUSOIDAL, *bbox_lonlat, densify_pts=41)
    col0 = math.floor((left - GRID_X0) / PIXEL_M)
    col1 = math.ceil((right - GRID_X0) / PIXEL_M)
    row0 = math.floor((GRID_Y0 - top) / PIXEL_M)
    row1 = math.ceil((GRID_Y0 - bottom) / PIXEL_M)
    transform = Affine(PIXEL_M, 0.0, GRID_X0 + col0 * PIXEL_M, 0.0, -PIXEL_M, GRID_Y0 - row0 * PIXEL_M)
    return Raster(crs=SINUSOIDAL, transform=transform, shape=(row1 - row0, col1 - col0))


def good_quality(qc: np.ndarray) -> np.ndarray:
    """True where the LST QC byte says good quality, or "other quality" with good data and LST error <= 2 K.

    Strict "good" alone drops most bare and cropland pixels around these cities (flagged "other" for
    emissivity error 0.01-0.02, not for clouds), which would empty the rural ring of the heat island.
    """
    finite = np.isfinite(qc)
    bits = np.where(finite, qc, QC_MANDATORY_MASK).astype(np.uint8)
    mandatory = bits & QC_MANDATORY_MASK
    data_good = ((bits >> QC_DATA_QUALITY_SHIFT) & 0b11) == 0
    error_ok = ((bits >> QC_LST_ERROR_SHIFT) & 0b11) <= MAX_LST_ERROR_CLASS
    return finite & ((mandatory == 0) | ((mandatory == QC_OTHER) & data_good & error_ok))


def dn_to_celsius(dn: np.ndarray) -> np.ndarray:
    return dn * LST_SCALE - KELVIN


def summer_lst(bbox_lonlat: tuple, period: Period, platform: str) -> ModisLst:
    raster = modis_raster(bbox_lonlat)
    prefix = PLATFORMS[platform]
    items = [item for dates in period_ranges(period) for item in search(COLLECTION, bbox_lonlat, dates)
             if item.id.startswith(prefix + ".") and in_period(item.properties["start_datetime"], period)]
    by_period = {}
    for item in items:
        by_period.setdefault(item.properties["start_datetime"], []).append(item)
    composites = parallel_map(lambda group: _composite(group, raster), list(by_period.values()))
    log.info("MODIS %s %s: %d items, %d composites", prefix, period.label, len(items), len(composites))
    if not composites:
        raise RuntimeError(f"No {prefix} composites for {bbox_lonlat}")
    result = {}
    for part in BANDS:
        stack = np.stack([c[part] for c in composites])
        result[part], result[f"{part}_count"] = median_with_min_count(stack, MIN_COMPOSITES)
    return ModisLst(raster=raster, composites=len(composites), **result)


def in_period(start_datetime: str, period: Period) -> bool:
    """Whether an 8-day composite belongs to the period: its middle day falls in one of the period's months."""
    middle = datetime.fromisoformat(start_datetime[:10]) + timedelta(days=COMPOSITE_DAYS // 2)
    first, last = period.months
    return middle.year in period.years and first <= middle.month <= last


def median_with_min_count(stack: np.ndarray, min_count: int) -> tuple:
    """Per-pixel nan-median over the first axis, NaN where fewer than `min_count` values; and the counts."""
    count = np.isfinite(stack).sum(axis=0)
    with np.errstate(all="ignore"):
        median = np.nanmedian(np.where(count >= min_count, stack, 0.0), axis=0)
    median[count < min_count] = np.nan
    return median.astype(np.float32), count


def _composite(items: list, raster: Raster) -> dict:
    """One 8-day period: day and night LST (°C) over `raster`, mosaicked over tiles, good pixels only."""
    out = {part: np.full(raster.shape, np.nan, dtype=np.float32) for part in BANDS}
    for item in items:
        for part, (lst_band, qc_band) in BANDS.items():
            dn = read_to_raster(item.assets[lst_band].href, raster, Resampling.nearest, nodata=LST_FILL)
            qc = read_to_raster(item.assets[qc_band].href, raster, Resampling.nearest, nodata=255)
            lst = dn_to_celsius(dn)
            lst[~good_quality(qc)] = np.nan
            gap = np.isnan(out[part])
            out[part][gap] = lst[gap]
    return out
