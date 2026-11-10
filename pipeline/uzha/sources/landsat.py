"""Summer land-surface temperature from Landsat 8/9 Collection 2 Level-2 (band ST_B10)."""
import calendar
import logging
from dataclasses import dataclass

import numpy as np
from rasterio.enums import Resampling

from ..grid import Raster
from ..stac import parallel_map, read_to_raster, search

log = logging.getLogger(__name__)

ST_SCALE = 0.00341802
ST_OFFSET = 149.0
KELVIN = 273.15

QA_FILL = 1 << 0
QA_DILATED_CLOUD = 1 << 1
QA_CLOUD = 1 << 3
QA_CLOUD_SHADOW = 1 << 4
QA_REJECT = QA_FILL | QA_DILATED_CLOUD | QA_CLOUD | QA_CLOUD_SHADOW

PLAUSIBLE_CELSIUS = (-10.0, 80.0)
MAX_SCENE_CLOUD = 20
MAX_SCENES = 30
MIN_SCENES = 3
MIN_SCENE_CLEAR_FRACTION = 0.2


@dataclass(frozen=True)
class Period:
    years: tuple
    months: tuple  # (first, last), inclusive
    label: str


PERIODS = (
    Period((2023, 2024, 2025), (6, 8), "июнь–август 2023–2025"),
    Period((2023, 2024, 2025), (5, 9), "май–сентябрь 2023–2025"),
    Period((2021, 2022, 2023, 2024, 2025), (5, 9), "май–сентябрь 2021–2025"),
)


@dataclass
class LstResult:
    lst: np.ndarray  # °C on the input raster, NaN where unknown
    scenes: int
    period: Period


def dn_to_celsius(dn: np.ndarray) -> np.ndarray:
    return dn * ST_SCALE + ST_OFFSET - KELVIN


def clear_sky(qa: np.ndarray) -> np.ndarray:
    """True where the QA_PIXEL value marks a valid, cloud- and shadow-free pixel."""
    finite = np.isfinite(qa)
    bits = np.where(finite, qa, QA_FILL).astype(np.uint16)
    return finite & ((bits & QA_REJECT) == 0)


def period_ranges(period: Period) -> list:
    first, last = period.months
    return [
        f"{year}-{first:02d}-01/{year}-{last:02d}-{calendar.monthrange(year, last)[1]}"
        for year in period.years
    ]


def summer_lst(bbox: tuple, raster: Raster) -> LstResult:
    for period in PERIODS:
        items = find_scenes(bbox, period)
        scenes = [lst for lst in parallel_map(lambda item: _scene_lst(item, raster), items)
                  if np.isfinite(lst).mean() >= MIN_SCENE_CLEAR_FRACTION]
        log.info("Landsat %s: %d items, %d usable", period.label, len(items), len(scenes))
        if len(scenes) >= MIN_SCENES:
            return LstResult(_robust_median(np.stack(scenes)), len(scenes), period)
    raise RuntimeError(f"Fewer than {MIN_SCENES} clear Landsat scenes for {bbox}")


def find_scenes(bbox: tuple, period: Period) -> list:
    query = {"platform": {"in": ["landsat-8", "landsat-9"]}, "eo:cloud_cover": {"lt": MAX_SCENE_CLOUD}}
    items = [item for dates in period_ranges(period)
             for item in search("landsat-c2-l2", bbox, dates, query)]
    items.sort(key=lambda item: item.properties["eo:cloud_cover"])
    return items[:MAX_SCENES]


def _scene_lst(item, raster: Raster) -> np.ndarray:
    qa = read_to_raster(item.assets["qa_pixel"].href, raster, Resampling.nearest, nodata=QA_FILL)
    dn = read_to_raster(item.assets["lwir11"].href, raster, Resampling.bilinear, nodata=0)
    lst = dn_to_celsius(dn)
    low, high = PLAUSIBLE_CELSIUS
    lst[~clear_sky(qa) | (lst < low) | (lst > high)] = np.nan
    return lst


def _robust_median(stack: np.ndarray) -> np.ndarray:
    """Per-pixel median, kept only where at least MIN_SCENES clear observations exist."""
    enough = np.isfinite(stack).sum(axis=0) >= MIN_SCENES
    with np.errstate(all="ignore"):
        median = np.nanmedian(np.where(enough, stack, 0.0), axis=0)
    median[~enough] = np.nan
    return median.astype(np.float32)
