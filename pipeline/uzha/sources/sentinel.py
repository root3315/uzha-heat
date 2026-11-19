"""Summer NDVI, broadband albedo and shortwave-infrared surface moisture from Sentinel-2 L2A."""
import logging
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np
from rasterio.enums import Resampling

from ..grid import Raster, aggregate
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


# --- Surface moisture from the shortwave infrared -------------------------------------------------------------------
# NDMI = (NIR − SWIR1)/(NIR + SWIR1) with the 20 m narrow NIR band B8A (865 nm) and SWIR1 B11 (1610 nm): the
# normalised difference moisture index of Wilson & Sader (2002), Remote Sens. Environ. 80, 385–396,
# https://doi.org/10.1016/S0034-4257(01)00318-2 (after Hardisky et al. 1983; Gao 1996 for the 1.24 µm variant).
# OPTRAM: Sadeghi, Babaeian, Tuller & Jones (2017), Remote Sens. Environ. 198, 52–68,
# https://doi.org/10.1016/j.rse.2017.05.041. The SWIR-transformed reflectance STR = (1 − R)²/(2R) (Kubelka–Munk,
# Sadeghi et al. 2015) is linear in soil moisture; in the STR–NDVI space the pixels fill a trapezoid between a dry
# edge STR_d = i_d + s_d·NDVI and a wet edge STR_w = i_w + s_w·NDVI, and W = (STR − STR_d)/(STR_w − STR_d) is the
# normalised moisture, θ = θ_d + W·(θ_w − θ_d). Sadeghi et al. use Sentinel-2 band 12 (2190 nm); the rOPTRAM
# package (rOpenSci, https://docs.ropensci.org/rOPTRAM/) defaults to B11. Edges are fitted as rOPTRAM does
# (optram_wetdry_coefficients): NDVI bins of 0.01 between the 2nd and 99th NDVI percentiles, STR outliers beyond
# 1.5 robust IQRs dropped in each bin, the 5th / 95th STR percentiles as dry / wet points, a straight line through
# each set. W follows rOPTRAM's linear_soil_moisture: (i_d + s_d·VI − STR)/(i_d − i_w + (s_d − s_w)·VI).
MOISTURE_BANDS = ("B04", "B08", "B8A", "B11", "B12")
OPTRAM_SWIR = "B12"
# Moisture is read from land pixels only: water (6) and the dark-area class (2, often shadows) would read as wet.
SCL_MOISTURE = (4, 5, 7)
MOISTURE_WORKERS = 3  # scenes read at once; each holds a few full-city float32 bands
EDGE_SAMPLE_PER_SCENE = 20_000  # pixels per scene kept for the STR–NDVI edge fit
EDGE_VI_STEP = 0.01
EDGE_MIN_PER_BIN = 20
EDGE_QUANTILES = (0.05, 0.95)
EDGE_VI_RANGE = (0.02, 0.99)  # quantiles of NDVI spanned by the bins
MIN_CELL_LAND_SHARE = 0.2  # share of a cell's pixels that must be clear land in a scene for its value to count


@dataclass
class MoistureResult:
    """Per-cell summer medians on the analysis grid (NaN where a cell never had enough clear land pixels)."""

    ndmi: np.ndarray
    wetness: np.ndarray  # OPTRAM W, 0 (dry edge) … 1 (wet edge)
    ndvi: np.ndarray  # NDVI of the same land pixels
    edges: dict  # dry/wet intercepts and slopes of STR = i + s·NDVI
    scenes: int


def ndmi(nir: np.ndarray, swir1: np.ndarray) -> np.ndarray:
    """Normalised difference moisture index (Wilson & Sader 2002)."""
    with np.errstate(divide="ignore", invalid="ignore"):
        value = (nir - swir1) / (nir + swir1)
    return np.where(np.isfinite(value), value, np.nan)


def swir_transformed(reflectance: np.ndarray) -> np.ndarray:
    """STR = (1 − R)²/(2R) (Sadeghi et al. 2017); NaN for R outside (0, 1]."""
    r = np.asarray(reflectance, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        value = (1.0 - r) ** 2 / (2.0 * r)
    return np.where((r > 0.0) & (r <= 1.0), value, np.nan)


def optram_wetness(str_value, vi, edges: dict) -> np.ndarray:
    """W = (STR − STR_d)/(STR_w − STR_d), clipped to 0..1 (Sadeghi et al. 2017); NaN where the edges cross."""
    vi = np.asarray(vi, dtype=float)
    dry = edges["i_dry"] + edges["s_dry"] * vi
    wet = edges["i_wet"] + edges["s_wet"] * vi
    with np.errstate(divide="ignore", invalid="ignore"):
        w = (np.asarray(str_value, dtype=float) - dry) / (wet - dry)
    return np.where(np.isfinite(w) & (wet > dry), np.clip(w, 0.0, 1.0), np.nan)


def fit_optram_edges(vi: np.ndarray, str_value: np.ndarray, step: float = EDGE_VI_STEP) -> dict:
    """Dry and wet edges of the STR–NDVI trapezoid, fitted as rOPTRAM does (see the note above)."""
    ok = np.isfinite(vi) & np.isfinite(str_value)
    vi, str_value = vi[ok], str_value[ok]
    low, high = np.quantile(vi, EDGE_VI_RANGE)
    centres, dry, wet = [], [], []
    for start in np.arange(low, high, step):
        in_bin = str_value[(vi >= start) & (vi < start + step)]
        if len(in_bin) < EDGE_MIN_PER_BIN:
            continue
        q1, q3 = np.quantile(in_bin, (0.25, 0.75))
        spread = 1.5 * (q3 - q1) / 1.349
        kept = in_bin[(in_bin > q1 - spread) & (in_bin < q3 + spread)]
        if len(kept) < EDGE_MIN_PER_BIN:
            continue
        q_dry, q_wet = np.quantile(kept, EDGE_QUANTILES)
        centres.append(start + step / 2.0)
        dry.append(q_dry)
        wet.append(q_wet)
    if len(centres) < 3:
        raise ValueError("too few NDVI bins to fit the OPTRAM edges")
    s_dry, i_dry = np.polyfit(centres, dry, 1)
    s_wet, i_wet = np.polyfit(centres, wet, 1)
    return {"i_dry": float(i_dry), "s_dry": float(s_dry), "i_wet": float(i_wet), "s_wet": float(s_wet),
            "bins": len(centres)}


def summer_moisture(bbox: tuple, raster: Raster, factor: int, exclude: np.ndarray = None,
                    seed: int = 0) -> MoistureResult:
    """Median summer NDMI and OPTRAM wetness per analysis cell (`factor` raster pixels per cell side).

    `exclude` (raster-shaped bool) masks pixels that are not soil or vegetation (built-up, water): asphalt is dark in
    the SWIR and would read as wet soil. Each scene is reduced at once to cell means of NDVI, STR and NDMI over its
    clear land pixels, plus a pixel sample for the edges, so only the scenes being read hold full bands. W is computed
    per scene from the cell means, with edges fitted on the pooled pixel samples of all scenes, then the median is
    taken over scenes.
    """
    items = _find_scenes(bbox)
    seeds = np.random.default_rng(seed).integers(0, 2 ** 31, len(items))
    with ThreadPoolExecutor(max_workers=MOISTURE_WORKERS) as pool:
        results = [r for r in pool.map(lambda pair: _scene_moisture(pair[0], raster, factor, exclude, pair[1]),
                                       zip(items, seeds)) if r is not None]
    log.info("Sentinel-2 moisture: %d items, %d usable", len(items), len(results))
    if not results:
        raise RuntimeError(f"No clear Sentinel-2 scenes for {bbox}")
    edges = fit_optram_edges(np.concatenate([r["sample_vi"] for r in results]),
                             np.concatenate([r["sample_str"] for r in results]))
    log.info("OPTRAM edges: %s", edges)
    with np.errstate(all="ignore"):
        return MoistureResult(
            ndmi=np.nanmedian(np.stack([r["ndmi"] for r in results]), axis=0).astype(np.float32),
            wetness=np.nanmedian(np.stack([optram_wetness(r["str"], r["ndvi"], edges) for r in results]),
                                 axis=0).astype(np.float32),
            ndvi=np.nanmedian(np.stack([r["ndvi"] for r in results]), axis=0).astype(np.float32),
            edges=edges, scenes=len(results))


def _scene_moisture(item, raster: Raster, factor: int, exclude, seed: int):
    """Cell means of NDVI, STR and NDMI over the scene's clear land pixels, and a pixel sample; None if too cloudy."""
    baseline = item.properties["s2:processing_baseline"]
    band = {name: to_reflectance(read_to_raster(item.assets[name].href, raster, Resampling.bilinear, nodata=0),
                                 baseline) for name in MOISTURE_BANDS}
    clear = np.isin(read_to_raster(item.assets["SCL"].href, raster, Resampling.nearest, nodata=0), SCL_MOISTURE)
    if exclude is not None:
        clear &= ~exclude
    if clear.mean() < MIN_SCENE_CLEAR_FRACTION:
        return None
    vi = np.where(clear, ndvi(band["B08"], band["B04"]), np.nan).astype(np.float32)
    moisture = np.where(clear, ndmi(band["B8A"], band["B11"]), np.nan).astype(np.float32)
    str_value = np.where(clear, swir_transformed(band[OPTRAM_SWIR]), np.nan).astype(np.float32)
    del band, clear
    ok = np.isfinite(vi) & np.isfinite(str_value)
    picked = np.flatnonzero(ok.ravel())
    if len(picked) > EDGE_SAMPLE_PER_SCENE:
        picked = np.random.default_rng(seed).choice(picked, EDGE_SAMPLE_PER_SCENE, replace=False)
    out = {"sample_vi": vi.ravel()[picked], "sample_str": str_value.ravel()[picked]}
    for key, layer in (("ndvi", vi), ("str", str_value), ("ndmi", moisture)):
        mean, valid = aggregate(np.where(ok, layer, np.nan), factor)
        out[key] = np.where(valid >= MIN_CELL_LAND_SHARE, mean, np.nan).astype(np.float32)
    return out
