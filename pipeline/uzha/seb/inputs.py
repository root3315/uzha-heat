"""Inputs of the physics model: a city's cells as `SebInputs` and the overpass weather as `Forcing`.

Starts from the exported city JSON (`web/public/data/<id>.json`: the cell table with WorldCover shares, roads,
buildings, height, volume, water distance, elevation, NDVI, albedo, LST) and adds four small downloads, each cached
under `pipeline/cache/seb/<id>_<grid>/`:

- WorldCover 2021 water share per cell (20 m nearest sample of the 10 m map, Planetary Computer);
- OSM drivable roads, reduced at once to road area per cell (length × width by class);
- ERA5 / ERA5-Land hourly at the city centre (Open-Meteo archive) and the Landsat acquisition times;
- AH4GUC anthropogenic heat (Varquez et al. 2021) for July and August at 06 UTC through OPeNDAP.

Every assumption below carries its source; pipeline/README.md ("Physics model inputs") has the same list.
"""
import argparse
import json
import logging
import math
import re
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import requests
from pyproj import Transformer

from .. import boundary, energy, weather
from ..cache import Cache
from ..cities import get_city
from ..grid import WGS84, Grid, aggregate
from ..sources import era5, osm, sentinel, worldcover
from . import physics
from .types import IMPERVIOUS, KELVIN, TILE, TILES, VON_KARMAN, CANYON_FLOOR, RD, Forcing, SebInputs

log = logging.getLogger(__name__)

PIPELINE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"
CACHE_ROOT = PIPELINE_DIR / "cache"
M2_PER_HA = 10_000.0
GRAVITY = 9.80665

# --- Tile fractions ------------------------------------------------------------------------------------------------
# WorldCover sampled at 20 m (every other 10 m pixel, nearest) for the water share: 100 samples per 200 m cell.
WATER_SAMPLE_FACTOR = 10
# Fallback when WorldCover cannot be read: water as a strip along one side of the cell. A strip covering w of a
# 200 m cell leaves the other pixels uniformly 0..(1 − w)·200 m from it, mean (1 − w)²·100 m, so w = 1 − √(d̄/100).
WATER_STRIP_HALF_M = 100.0
# Carriageway width by OSM highway class, m: lanes × 3.5 m (a standard lane, e.g. AASHTO 2018 "Green Book" 12 ft)
# for the usual lane count of each class, plus median/shoulders on motorways and trunks. Assumption, not measured;
# an OSM `width` tag, else `lanes` × 3.5 m, overrides it way by way.
LANE_WIDTH_M = 3.5
ROAD_WIDTH_M = {
    "motorway": 22.0, "trunk": 18.0, "primary": 14.0, "secondary": 11.0, "tertiary": 8.0,
    "unclassified": 6.0, "residential": 6.0, "living_street": 5.0, "service": 4.0,
}
LINK_WIDTH_M = 6.0
FALLBACK_ROAD_WIDTH_M = 7.0  # city-wide mean width used with the JSON road density if OSM cannot be read
ROAD_TILES = 3
MIN_WIDTH_M, MAX_WIDTH_M = 2.5, 60.0

# --- Radiative properties of the tiles ----------------------------------------------------------------------------
# Albedo and emissivity of natural surfaces: Oke (1987) Boundary Layer Climates, 2nd ed., Table 1.1; of urban
# materials: Oke (1987) Table 8.2 (Routledge, https://doi.org/10.4324/9780203407219). A value near the middle of
# each range is taken. Tree: deciduous forest α 0.15–0.20, ε 0.97–0.98. Grass: 0.16–0.26, ε 0.90–0.95. Bare: dry
# soil α 0.25 (light loess-type soils of the region are at the low end of 0.25–0.45), ε 0.90–0.98 for soils.
# Water at high sun: α 0.03–0.10, ε 0.92–0.97. Roofs (tile, concrete, painted metal): ε ≈ 0.90–0.92. Asphalt
# ε 0.95. Concrete ε 0.71–0.90.
NATURAL_ALBEDO = {"tree": 0.16, "grass": 0.21, "bare": 0.25, "water": 0.08}
EMISSIVITY = {"tree": 0.98, "grass": 0.95, "bare": 0.93, "roof": 0.91, "road": 0.95, "paved": 0.90, "water": 0.96}
# The impervious tiles share one albedo per cell, inverted from the Sentinel-2 cell albedo and kept in a physical
# range (fresh asphalt 0.05–0.10 … white concrete/roof coatings ~0.45). Used as is where the cell has almost no
# impervious surface to invert from.
IMPERVIOUS_ALBEDO_RANGE = (0.08, 0.45)
DEFAULT_IMPERVIOUS_ALBEDO = 0.18
MIN_IMPERVIOUS_FOR_INVERSION = 0.05

# --- Storage: objective hysteresis model ----------------------------------------------------------------------------
# a1 (-), a2 (h), a3 (W m⁻²) from Grimmond & Oke (1999) J. Appl. Meteorol. 38, 922–940, Table 4,
# https://doi.org/10.1175/1520-0450(1999)038<0922:HSIUAL>2.0.CO;2 (a3 signs negative as in the OHM).
OHM_SOURCES = {
    "tree": [(0.11, 0.11, -12.3)],  # mixed forest, McCaughey (1985)
    "grass": [(0.32, 0.54, -27.4)],  # short grass, Doll et al. (1985)
    "bare": [(0.35, 0.43, -36.5)],  # bare soil, dry, Fuchs & Hadas (1972): summer bare ground in the city is dry
    "water": [(0.50, 0.21, -39.1)],  # water, shallow turbid, Souch et al. (1998)
    # rooftops: Vancouver (Yap 1973), Uppsala (Taesler 1980), Kyoto (Yoshida et al. 1990–91); their mean
    "roof": [(0.17, 0.10, -17.0), (0.44, 0.57, -28.9), (0.82, 0.34, -55.7)],
    # asphalt: Narita et al. (1984), Asaeda & Ca (1993), Anandakumar (1998); their mean
    "road": [(0.36, 0.23, -19.3), (0.64, 0.32, -43.6), (0.82, 0.68, -20.1)],
    # concrete: Doll et al. (1985), Asaeda & Ca (1993); their mean (pavements, yards, car parks)
    "paved": [(0.81, 0.48, -79.9), (0.85, 0.32, -28.5)],
}
OHM = {tile: tuple(np.mean(rows, axis=0)) for tile, rows in OHM_SOURCES.items()}

# --- Roughness ------------------------------------------------------------------------------------------------------
# Building arrays: Macdonald, Griffiths & Hall (1998) Atmos. Environ. 32, 1857–1864,
# https://doi.org/10.1016/S1352-2310(97)00403-2, Eq. 23 and 26 with the staggered-array constants:
#   zd/H = 1 + A^(−λp)·(λp − 1),  z0/H = (1 − zd/H)·exp(−[0.5·β·(CD/κ²)·(1 − zd/H)·λf]^(−1/2))
# A = 4.43, β = 1.0, CD = 1.2. λf = λp·H/L for buildings of side L (one face to the wind).
MACDONALD_A = 4.43
MACDONALD_BETA = 1.0
MACDONALD_CD = 1.2
MAX_PATCH_LAMBDA_P = 0.9
MIN_URBAN_Z0 = 0.01  # a paved patch without buildings (cars, kerbs, street furniture); flat asphalt is ~0.005
BUILDING_SIDE_RANGE_M = (6.0, 60.0)
# Vegetation and open surfaces: trees z0 ≈ 0.1·h, zd ≈ ⅔·h (Garratt 1992, The Atmospheric Boundary Layer, CUP,
# §4.2, Table 4.1), street/park trees taken as 10 m tall; grass, bare soil and water from the Davenport–Wieringa
# classification (Wieringa 1993, Boundary-Layer Meteorol. 63, 323–363, https://doi.org/10.1007/BF00705357).
TREE_HEIGHT_M = 10.0
OPEN_Z0 = {"grass": 0.03, "bare": 0.005, "water": 0.0002}
# Cell values: zd area-weighted, z0 by area-weighted ln z0 (Taylor 1987, Boundary-Layer Meteorol. 39, 15–39,
# https://doi.org/10.1007/BF00121863).

# --- Canyon geometry ------------------------------------------------------------------------------------------------
MAX_ASPECT = 6.0  # H/W cap: SVF ≥ 0.08, deep enough for any street of the region

# --- Forcing --------------------------------------------------------------------------------------------------------
LAPSE_RATE_K_PER_M = 0.0065  # environmental lapse rate, 6.5 K/km (ICAO standard atmosphere), Eq. 47
Z_REF_M = 60.0  # blending height for wind and air temperature, above the roughness sublayer of the 6–12 m city
ERA5_Z0_M = 0.1  # roughness of the ERA5 box the 10 m wind refers to ("roughly open", Wieringa 1993)
ERA5_VARIABLES = ("temperature_2m", "dew_point_2m", "wind_speed_10m", "surface_pressure",
                  "shortwave_radiation_instant", "direct_normal_irradiance_instant", "diffuse_radiation_instant")
ERA5_LAND_VARIABLES = ("soil_moisture_0_to_7cm",)

# --- Surface moisture per cell (Sentinel-2 shortwave infrared, sources/sentinel.py) --------------------------------
# Read at 200 m / 7 ≈ 28.6 m, the resolution of the existing NDVI/albedo layer (features.FINE_FACTOR); B11, B12 and
# B8A are 20 m natively.
MOISTURE_SAMPLE_FACTOR = 7
# OPTRAM W → volumetric moisture, θ = θ_d + W·(θ_w − θ_d) (Sadeghi et al. 2017, linear model): θ_w the saturated
# water content of the model's soil (physics.THETA_SAT), θ_d the air-dry surface of a loam, 0.03 m³ m⁻³ (the
# 0.03–0.05 of sun-dried topsoil; Carsel & Parrish 1988, Water Resour. Res. 24, 755–769, give a residual 0.078 for
# loam, but the top centimetres of summer loess dry below it).
THETA_AIR_DRY = 0.03
THETA_WET = physics.THETA_SAT
# Off by default: see the out-of-fold scores in pipeline/README.md ("Physics model inputs", surface moisture).
USE_SURFACE_MOISTURE = False
# Where W is known it also sets the vegetation's water: θ(W) feeds the Jarvis f2 of grass and trees, and a cell counts
# as irrigated (f2 = 1) when θ(W) reaches field capacity, instead of the "every cell inside the outline" rule.
MOISTURE_DRIVES_VEGETATION = True
# Shift θ(W) so its mean over the cells with W equals the ERA5-Land 0–7 cm value (W then only says where it is
# wetter or drier than the city mean). Off: the surface is not the 0–7 cm layer, and dry loess is far below it.
MOISTURE_ANCHOR_ERA5 = False
# Which index gives W: "optram" (STR of B12, Sadeghi et al. 2017) or "ndmi", the same trapezoid normalisation applied
# to NDMI against NDVI over the city's cells (dry / wet edge = 5th / 95th NDMI percentile per NDVI bin).
MOISTURE_INDEX = "optram"
NDMI_EDGE_VI_STEP = 0.02

# --- Anthropogenic heat -------------------------------------------------------------------------------------------
# AH4GUC: Varquez, Kiyomoto, Khanh & Kanda (2021) Sci. Data 8, 64, https://doi.org/10.1038/s41597-021-00850-w,
# CC BY 4.0. Global 30″ grid, typical hourly AHE per month, present (2010) under SSP3. Int32 × 1e-5 = W m⁻².
AH4GUC_URL = ("https://urbanclimate.tse.ens.isct.ac.jp/opendap/public/AHE/AH4GUC/present/"
              "AHE_SSP3_2010_{month:02d}_{hour:02d}HR_UTC.tif.ascii")
AH4GUC_MONTHS = (7, 8)
AH4GUC_HOUR_UTC = 6  # the Landsat overpass is ~05:50 UTC (10:50 local)
AH4GUC_PIXELS_PER_DEGREE = 120
AH4GUC_SCALE = 1e-5
QF_LABEL = "Estimated"
QF_SOURCE = "AH4GUC (Varquez et al. 2021), July–August 06 UTC, 1 km spread over 200 m cells by building volume"
TIMEOUT_S = (30, 180)


# ===================================================================================================================
# Tile fractions
# ===================================================================================================================

# Fractional vegetation cover from NDVI, linear between bare-soil and full-canopy end members (Gutman & Ignatov 1998,
# Int. J. Remote Sens. 19, 1533–1543). The squared form of Carlson & Ripley (1997) was tried and scored worse out of
# fold on Tashkent (R² 0.33 against 0.42): it leaves sparse, watered city green almost bare.
NDVI_SOIL, NDVI_VEG = 0.15, 0.75


def vegetation_cover(ndvi) -> np.ndarray:
    """Share of the cell under green vegetation, 0..1 (theory Eq. 49 note: NDVI feeds cover through a stated conversion)."""
    return np.clip((np.asarray(ndvi, float) - NDVI_SOIL) / (NDVI_VEG - NDVI_SOIL), 0.0, 1.0)


def tile_fractions(tree_pct, built_pct, bare_pct, water_share, roof_share, road_share, ndvi=None) -> np.ndarray:
    """(n, T) area shares that sum to 1.

    tree, built, bare: WorldCover shares in %. water_share, roof_share, road_share: 0..1. Grass is what is left of
    the natural part (WorldCover grass, crops, shrubs, wetland). Roofs and roads are cut to fit inside `built`, and
    paved = built − roof − road. Rows whose shares add up to more than 1 are scaled down.

    With `ndvi`, the open ground (WorldCover grass and bare together) is split by what is actually green in summer:
    green cover from NDVI beyond the tree crowns becomes the grass tile, the rest bare. WorldCover's annual "grass"
    class includes fallow and dry land that is bare by July, and is blind to watering.
    """
    tree, built, bare = (np.clip(np.asarray(v, float) / 100.0, 0, 1) for v in (tree_pct, built_pct, bare_pct))
    water = np.clip(np.asarray(water_share, float), 0, 1)
    roof = np.minimum(np.clip(np.asarray(roof_share, float), 0, 1), built)
    road = np.minimum(np.clip(np.asarray(road_share, float), 0, 1), built - roof)
    paved = np.maximum(built - roof - road, 0.0)
    grass = np.maximum(1.0 - tree - built - bare - water, 0.0)
    if ndvi is not None:
        open_ground = grass + bare
        grass = np.clip(vegetation_cover(ndvi) - tree, 0.0, open_ground)
        bare = open_ground - grass
    out = np.zeros((len(tree), len(TILES)))
    for name, share in (("tree", tree), ("grass", grass), ("bare", bare), ("roof", roof), ("road", road),
                        ("paved", paved), ("water", water)):
        out[:, TILE[name]] = share
    total = out.sum(axis=1, keepdims=True)
    return np.where(total > 0, out / np.where(total > 0, total, 1), _all_grass(len(out)))


def _all_grass(n: int) -> np.ndarray:
    out = np.zeros((n, len(TILES)))
    out[:, TILE["grass"]] = 1.0
    return out


def roof_share(volume_m3_per_ha, height_m) -> np.ndarray:
    """Building footprint share of the cell: the JSON volume is GHSL Built-S share × height × 10 000 m²/ha
    (features.building_form), so the share is volume / (height · 10 000)."""
    volume, height = np.asarray(volume_m3_per_ha, float), np.asarray(height_m, float)
    with np.errstate(invalid="ignore", divide="ignore"):
        share = np.where(height > 0, volume / (height * M2_PER_HA), 0.0)
    return np.clip(np.nan_to_num(share), 0.0, 1.0)


def water_share_from_distance(water_dist_m) -> np.ndarray:
    """Fallback water share from the mean distance to water (strip model, see WATER_STRIP_HALF_M)."""
    d = np.clip(np.asarray(water_dist_m, float), 0.0, WATER_STRIP_HALF_M)
    return 1.0 - np.sqrt(d / WATER_STRIP_HALF_M)


def road_width(tags: dict) -> float:
    """Carriageway width of an OSM way, m: `width` tag, else `lanes` × 3.5 m, else the class default."""
    for key, scale in (("width", 1.0), ("lanes", LANE_WIDTH_M)):
        match = re.match(r"\s*(\d+(?:[.,]\d+)?)\s*(m|м)?\s*$", str(tags.get(key, "")))
        if match:
            return float(np.clip(float(match.group(1).replace(",", ".")) * scale, MIN_WIDTH_M, MAX_WIDTH_M))
    highway = tags.get("highway", "")
    return LINK_WIDTH_M if highway.endswith("_link") else ROAD_WIDTH_M.get(highway, LINK_WIDTH_M)


def road_area_share(elements: list, grid: Grid) -> np.ndarray:
    """Road area / cell area on the grid, from OSM ways with geometry (length per cell × width)."""
    to_utm = Transformer.from_crs(WGS84, grid.crs, always_xy=True)
    by_width = {}
    for el in elements:
        if len(el.get("geometry", ())) >= 2:
            by_width.setdefault(road_width(el.get("tags", {})), []).append(osm._project(to_utm, el["geometry"]))
    area = np.zeros(grid.shape)
    for width, lines in by_width.items():
        area += osm.line_length_per_cell(grid, lines) * width
    return area / grid.cell_size ** 2


def fetch_road_area(bbox: tuple, grid: Grid):
    """Road area share on the grid, fetched in tiles and reduced tile by tile (the raw ways are never all in memory);
    ways crossing tiles are counted once. None if Overpass fails."""
    seen, area = set(), np.zeros(grid.shape)
    for part in osm.split_bbox(bbox, ROAD_TILES):
        elements = osm.overpass(f'way["highway"~"^({osm.ROAD_TYPES})(_link)?$"]{osm.overpass_bbox(part)};out geom;')
        if elements is None:
            return None
        fresh = [el for el in elements if el["id"] not in seen]
        seen.update(el["id"] for el in fresh)
        area += road_area_share(fresh, grid)
        del elements, fresh
    return area


def fetch_surface_moisture(bbox: tuple, grid: Grid) -> dict:
    """Per-cell summer NDMI and OPTRAM wetness W from Sentinel-2 (sources/sentinel.py), over soil and vegetation
    pixels only: WorldCover built-up and water pixels are masked, since dark asphalt and water read as wet soil in the
    shortwave infrared. Grid-shaped float32 arrays plus the fitted edges, for the cache."""
    raster = grid.raster(MOISTURE_SAMPLE_FACTOR)
    classes = worldcover.land_cover(bbox, raster)
    exclude = np.isin(classes, (worldcover.BUILT, worldcover.WATER, worldcover.NO_DATA))
    del classes
    result = sentinel.summer_moisture(bbox, raster, MOISTURE_SAMPLE_FACTOR, exclude=exclude)
    return {"ndmi": result.ndmi, "wetness": result.wetness, "ndvi": result.ndvi, "edges": result.edges,
            "scenes": result.scenes}


def layer_wetness(layer: dict, index: str = None) -> np.ndarray:
    """Grid-shaped W from the cached moisture layer: OPTRAM W, or NDMI normalised between its dry and wet edges in
    the NDMI–NDVI space of the city's cells (the trapezoid of Sadeghi et al. 2017 with NDMI in place of STR)."""
    index = index or MOISTURE_INDEX
    if index == "optram":
        return np.asarray(layer["wetness"], float)
    if index != "ndmi":
        raise ValueError(f"unknown moisture index {index!r}")
    ndmi, vi = np.asarray(layer["ndmi"], float), np.asarray(layer["ndvi"], float)
    edges = sentinel.fit_optram_edges(vi.ravel(), ndmi.ravel(), step=NDMI_EDGE_VI_STEP)
    return sentinel.optram_wetness(ndmi, vi, edges)


def wetness_to_theta(wetness) -> np.ndarray:
    """θ = θ_d + W·(θ_w − θ_d), m³ m⁻³ (Sadeghi et al. 2017, linear OPTRAM model); NaN stays NaN."""
    return THETA_AIR_DRY + np.clip(np.asarray(wetness, float), 0.0, 1.0) * (THETA_WET - THETA_AIR_DRY)


def cell_moisture(wetness, era5_theta: float, irrigated, anchor: bool = False, vegetation: bool = True) -> tuple:
    """(soil moisture per cell, irrigated per cell). Cells with an OPTRAM W take θ(W), shifted to the ERA5-Land mean
    when `anchor`; the others keep the ERA5-Land value and the given irrigated flag. With `vegetation`, a cell with W
    is irrigated exactly when θ(W) reaches field capacity (its vegetation is then unstressed, f2 = 1)."""
    theta = wetness_to_theta(wetness)
    known = np.isfinite(theta)
    if anchor and known.any():
        theta = theta - theta[known].mean() + era5_theta
    theta = np.where(known, np.clip(theta, THETA_AIR_DRY, THETA_WET), era5_theta)
    irrigated = np.asarray(irrigated, bool)
    if vegetation:
        irrigated = np.where(known, theta >= physics.THETA_CAP, irrigated)
    return theta, irrigated


def fetch_water_share(bbox: tuple, grid: Grid) -> np.ndarray:
    """WorldCover class 80 (permanent water) share per cell, from a 20 m nearest sample."""
    raster = grid.raster(WATER_SAMPLE_FACTOR)
    classes = worldcover.land_cover(bbox, raster)
    share, _ = aggregate(worldcover.class_share(classes, worldcover.WATER), WATER_SAMPLE_FACTOR)
    return share.astype(np.float32)


# ===================================================================================================================
# Radiative properties
# ===================================================================================================================

def impervious_albedo(cell_albedo, fraction: np.ndarray) -> np.ndarray:
    """One albedo for roof, road and paved per cell such that Σ f_k·α_k equals the Sentinel-2 cell albedo,
    clipped to IMPERVIOUS_ALBEDO_RANGE; DEFAULT_IMPERVIOUS_ALBEDO where there is too little impervious surface."""
    cell_albedo = np.asarray(cell_albedo, float)
    f_imp = sum(fraction[:, TILE[t]] for t in IMPERVIOUS)
    natural = sum(fraction[:, TILE[t]] * a for t, a in NATURAL_ALBEDO.items())
    with np.errstate(invalid="ignore", divide="ignore"):
        inverted = (cell_albedo - natural) / f_imp
    inverted = np.clip(inverted, *IMPERVIOUS_ALBEDO_RANGE)
    return np.where(f_imp >= MIN_IMPERVIOUS_FOR_INVERSION, inverted, DEFAULT_IMPERVIOUS_ALBEDO)


def albedo_matrix(cell_albedo, fraction: np.ndarray) -> np.ndarray:
    out = np.zeros_like(fraction)
    for tile, value in NATURAL_ALBEDO.items():
        out[:, TILE[tile]] = value
    a_imp = impervious_albedo(cell_albedo, fraction)
    for tile in IMPERVIOUS:
        out[:, TILE[tile]] = a_imp
    return out


def emissivity_matrix(n: int) -> np.ndarray:
    return np.tile([EMISSIVITY[t] for t in TILES], (n, 1)).astype(float)


def ohm_matrix(n: int) -> np.ndarray:
    return np.tile(np.array([OHM[t] for t in TILES], float), (n, 1, 1))


# ===================================================================================================================
# Urban form: building size, canyon aspect, sky view, shade, roughness
# ===================================================================================================================

def urban_patch(fraction: np.ndarray) -> tuple:
    """(share of the cell that is roof + road + paved, λp of buildings inside that patch)."""
    f_urb = sum(fraction[:, TILE[t]] for t in IMPERVIOUS)
    with np.errstate(invalid="ignore", divide="ignore"):
        lp = np.where(f_urb > 0, fraction[:, TILE["roof"]] / f_urb, 0.0)
    return f_urb, np.clip(lp, 0.0, MAX_PATCH_LAMBDA_P)


def building_side(roof: np.ndarray, buildings_per_ha) -> np.ndarray:
    """Mean building side L, m: √(footprint area per building) = √(roof share · 10 000 / count per ha).
    Cells with buildings in GHSL but none in OSM take the city median."""
    count = np.asarray(buildings_per_ha, float)
    with np.errstate(invalid="ignore", divide="ignore"):
        side = np.sqrt(roof * M2_PER_HA / count)
    known = (count > 0) & (roof > 0) & np.isfinite(side)
    median = float(np.median(side[known])) if known.any() else 15.0
    return np.clip(np.where(known, side, median), *BUILDING_SIDE_RANGE_M)


def canyon_aspect(height, lambda_p, side) -> np.ndarray:
    """H/W of a regular array of square buildings of side L at plan density λp: street width W = L·(1/√λp − 1)."""
    height, lp = np.asarray(height, float), np.asarray(lambda_p, float)
    with np.errstate(invalid="ignore", divide="ignore"):
        width = side * (1.0 / np.sqrt(lp) - 1.0)
        aspect = np.where((lp > 0) & (height > 0), height / width, 0.0)
    return np.clip(np.nan_to_num(aspect), 0.0, MAX_ASPECT)


def sky_view(aspect) -> np.ndarray:
    """SVF at the middle of a long canyon floor: cos(atan(2·H/W)) (Oke 1987, §8.2; Oke 1981, J. Climatol. 1,
    237–254, https://doi.org/10.1002/joc.3370010304). This is the cosine-weighted view factor of a horizontal
    surface (the one that weights longwave), not the solid-angle form of theory Eq. 20; 1 in open land."""
    return np.cos(np.arctan(2.0 * np.asarray(aspect, float)))


def canyon_shade(aspect, zenith: float) -> np.ndarray:
    """Share of the canyon floor in building shadow, averaged over street orientations (Masson 2000,
    Boundary-Layer Meteorol. 94, 357–397, https://doi.org/10.1023/A:1002463829265, direct radiation on the road):
    sunlit = 2θ0/π − (2/π)·(H/W)·tan ζ·(1 − cos θ0), θ0 = arcsin(min(1, (W/H)/tan ζ))."""
    a = np.asarray(aspect, float) * math.tan(zenith)
    with np.errstate(invalid="ignore", divide="ignore"):
        theta0 = np.arcsin(np.minimum(1.0, np.where(a > 0, 1.0 / a, 1.0)))
    sunlit = 2.0 * theta0 / math.pi - 2.0 / math.pi * a * (1.0 - np.cos(theta0))
    return np.clip(1.0 - sunlit, 0.0, 1.0)


def shade_matrix(aspect, zenith: float) -> np.ndarray:
    out = np.zeros((len(aspect), len(TILES)))
    floor = canyon_shade(aspect, zenith)
    for tile in CANYON_FLOOR:
        out[:, TILE[tile]] = floor
    return out


def macdonald(height, lambda_p, lambda_f) -> tuple:
    """(z0, zd), m, of a building array (Macdonald et al. 1998, staggered arrays)."""
    h, lp, lf = (np.asarray(v, float) for v in (height, lambda_p, lambda_f))
    zd_h = 1.0 + MACDONALD_A ** (-lp) * (lp - 1.0)
    drag = 0.5 * MACDONALD_BETA * MACDONALD_CD / VON_KARMAN ** 2 * (1.0 - zd_h) * lf
    with np.errstate(divide="ignore"):
        z0_h = (1.0 - zd_h) * np.exp(-1.0 / np.sqrt(drag))
    z0_h = np.where(drag > 0, z0_h, 0.0)
    return z0_h * h, zd_h * h


def roughness(fraction: np.ndarray, height, side) -> tuple:
    """Cell (z0m, zd): Macdonald on the urban patch (roof + road + paved), trees, grass, bare and water by their
    own values, blended by area (zd linear, z0 in ln)."""
    f_urb, lp = urban_patch(fraction)
    lf = lp * np.asarray(height, float) / side
    z0_u, zd_u = macdonald(height, lp, lf)
    z0_u = np.maximum(z0_u, MIN_URBAN_Z0)
    parts = [(f_urb, z0_u, zd_u),
             (fraction[:, TILE["tree"]], 0.1 * TREE_HEIGHT_M, 2.0 / 3.0 * TREE_HEIGHT_M)]
    parts += [(fraction[:, TILE[t]], z0, 0.0) for t, z0 in OPEN_Z0.items()]
    ln_z0 = sum(f * np.log(z0) for f, z0, _ in parts)
    zd = sum(f * d for f, _, d in parts)
    return np.exp(ln_z0), zd


# ===================================================================================================================
# Weather at the overpass
# ===================================================================================================================

def solar_position(lat_deg: float, lon_deg: float, day_of_year: float, utc_hour: float) -> dict:
    """Zenith (Eq. 17: cos θz = sin φ sin δ + cos φ cos δ cos h), declination δ and hour angle h, rad.
    δ and the equation of time from Spencer (1971), Search 2, 172, as given by Iqbal (1983) An Introduction to
    Solar Radiation, Eq. 1.3.1 and 1.4.1."""
    g = 2.0 * math.pi * (day_of_year - 1.0) / 365.0
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
            + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    eot_min = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                        - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    solar_hour = utc_hour + lon_deg / 15.0 + eot_min / 60.0
    hour_angle = math.radians(15.0 * (solar_hour - 12.0))
    phi = math.radians(lat_deg)
    cos_z = math.sin(phi) * math.sin(decl) + math.cos(phi) * math.cos(decl) * math.cos(hour_angle)
    return {"zenith": math.acos(max(-1.0, min(1.0, cos_z))), "declination": decl, "hour_angle": hour_angle,
            "latitude": phi}


def clear_sky_tendency(k_down: float, sun: dict) -> float:
    """dK↓/dt, W m⁻² h⁻¹, with the atmosphere's transmissivity held at its overpass value: K↓ ∝ cos θz, and
    d(cos θz)/dt = −cos φ cos δ sin h · dh/dt, dh/dt = 15°/h."""
    cos_z = math.cos(sun["zenith"])
    d_cos = -math.cos(sun["latitude"]) * math.cos(sun["declination"]) * math.sin(sun["hour_angle"]) * math.pi / 12.0
    return k_down * d_cos / cos_z


def vapour_pressure_kpa(dew_point_c) -> np.ndarray:
    """e = e_s(T_d), Magnus over water (Alduchov & Eskridge 1996, the constants of weather.py/energy.py), kPa."""
    td = np.asarray(dew_point_c, float)
    return energy.MAGNUS_E0 * np.exp(energy.MAGNUS_A * td / (energy.MAGNUS_B + td)) / 10.0


def _utc_naive(moment: datetime) -> datetime:
    return moment.astimezone(timezone.utc).replace(tzinfo=None) if moment.tzinfo else moment


def at_moments(series: dict, moments: list, keys: tuple) -> dict:
    """Each variable linearly interpolated in time to each UTC moment (series in UTC), then averaged; also the
    number of moments used. Moments outside the series or next to a gap are skipped."""
    stamps = np.array([datetime.fromisoformat(s).timestamp() for s in
                       (t + ":00+00:00" if len(t) == 16 else t for t in series["time"])])
    values = {key: np.array([np.nan if v is None else v for v in series[key]], float) for key in keys}
    picked = {key: [] for key in keys}
    for moment in moments:
        t = _utc_naive(moment).replace(tzinfo=timezone.utc).timestamp()
        i = np.searchsorted(stamps, t) - 1
        if i < 0 or i + 1 >= len(stamps):
            continue
        w = (t - stamps[i]) / (stamps[i + 1] - stamps[i])
        row = {key: (1 - w) * values[key][i] + w * values[key][i + 1] for key in keys}
        if all(np.isfinite(v) for v in row.values()):
            for key in keys:
                picked[key].append(row[key])
    used = len(picked[keys[0]])
    if not used:
        raise ValueError("no overpass moment inside the weather series")
    return {**{key: float(np.mean(v)) for key, v in picked.items()}, "count": used,
            "vapour_kpa": float(np.mean(vapour_pressure_kpa(picked["dew_point_2m"])))
            if "dew_point_2m" in picked else None}


def mean_overpass(moments: list) -> tuple:
    """(mean day of year, mean UTC hour) of the overpass moments."""
    utc = [_utc_naive(m) for m in moments]
    return (float(np.mean([m.timetuple().tm_yday for m in utc])),
            float(np.mean([m.hour + m.minute / 60.0 + m.second / 3600.0 for m in utc])))


def lapse_corrected(t_ref_k: float, ref_elevation_m: float, elevation_m) -> np.ndarray:
    """Eq. 47: T(z) = T(z_ref) − Γ·(z − z_ref), Γ = 6.5 K/km."""
    return t_ref_k - LAPSE_RATE_K_PER_M * (np.asarray(elevation_m, float) - ref_elevation_m)


def pressure_at(p_ref_kpa: float, ref_elevation_m: float, elevation_m, t_k) -> np.ndarray:
    """Hypsometric equation over the small height difference: p = p_ref·exp(−g·Δz/(R_d·T))."""
    dz = np.asarray(elevation_m, float) - ref_elevation_m
    return p_ref_kpa * np.exp(-GRAVITY * dz / (RD * np.asarray(t_k, float)))


def wind_at(u10: float, z: float = Z_REF_M, z0: float = ERA5_Z0_M) -> float:
    """Neutral log law from 10 m to z over the ERA5 box roughness: u(z) = u10·ln(z/z0)/ln(10/z0)."""
    return u10 * math.log(z / z0) / math.log(10.0 / z0)


def brutsaert_l_down(t_k, e_kpa) -> np.ndarray:
    """Clear-sky L↓ = 1.24·(e/T)^(1/7)·σT⁴, e in hPa (Brutsaert 1975; energy.py)."""
    t_k = np.asarray(t_k, float)
    eps = energy.BRUTSAERT_COEF * (np.asarray(e_kpa, float) * 10.0 / t_k) ** energy.BRUTSAERT_EXP
    return eps * energy.SIGMA * t_k ** 4


def forcing(era: dict, ref_elevation_m: float, elevation_m, center: tuple, moments: list) -> Forcing:
    """Forcing per cell from the ERA5 overpass means (`at_moments` output)."""
    n = len(elevation_m)
    t_air = lapse_corrected(era["temperature_2m"] + KELVIN, ref_elevation_m, elevation_m)
    e_air = np.full(n, era["vapour_kpa"])  # vapour pressure taken as horizontally uniform
    day, hour = mean_overpass(moments)
    sun = solar_position(center[1], center[0], day, hour)
    k_down = era["shortwave_radiation_instant"]
    return Forcing(
        k_down=np.full(n, k_down),
        diffuse_fraction=np.full(n, min(1.0, era["diffuse_radiation_instant"] / k_down)),
        l_down=brutsaert_l_down(t_air, e_air),
        t_air=t_air,
        e_air=e_air,
        pressure=pressure_at(era["surface_pressure"] / 10.0, ref_elevation_m, elevation_m, t_air),
        wind=np.full(n, wind_at(era["wind_speed_10m"])),
        z_ref=Z_REF_M,
        zenith=sun["zenith"],
        dk_dt=clear_sky_tendency(k_down, sun),
    )


# ===================================================================================================================
# Anthropogenic heat
# ===================================================================================================================

def ah4guc_index(lon, lat) -> tuple:
    """(row, col) of the AH4GUC 30″ pixel holding each point: the grid starts at 90°N, 180°W."""
    lon, lat = np.asarray(lon, float), np.asarray(lat, float)
    row = np.floor((90.0 - lat) * AH4GUC_PIXELS_PER_DEGREE).astype(int)
    col = np.floor((lon + 180.0) * AH4GUC_PIXELS_PER_DEGREE).astype(int)
    return row, col


def parse_opendap_ascii(text: str) -> np.ndarray:
    """Rows of `band_1.band_1[i], v, v, …` from an OPeNDAP .ascii answer, as an int array."""
    rows = [line.split(",")[1:] for line in text.splitlines() if line.startswith("band_1.band_1[")]
    if not rows:
        raise ValueError(f"no data rows in the OPeNDAP answer: {text[:200]!r}")
    return np.array([[int(v) for v in row] for row in rows])


def fetch_ah4guc(window: tuple, months: tuple = AH4GUC_MONTHS, hour: int = AH4GUC_HOUR_UTC) -> np.ndarray:
    """Mean AHE (W m⁻²) of the months at the hour over the window (row0, row1, col0, col1), inclusive."""
    r0, r1, c0, c1 = window
    layers = []
    for month in months:
        url = AH4GUC_URL.format(month=month, hour=hour) + f"?band_1.band_1[{r0}:1:{r1}][{c0}:1:{c1}]"
        response = requests.get(url, timeout=TIMEOUT_S, headers={"User-Agent": era5.USER_AGENT})
        response.raise_for_status()
        layers.append(np.clip(parse_opendap_ascii(response.text), 0, None) * AH4GUC_SCALE)
    return np.mean(layers, axis=0)


def redistribute_by_volume(pixel_qf: np.ndarray, pixel_id: np.ndarray, volume) -> np.ndarray:
    """Per cell QF: each 1 km pixel's value spread over its cells in proportion to building volume, so that the
    mean over the pixel's cells stays the pixel value (the 1 km total over the cells is kept). A pixel whose cells
    have no buildings spreads evenly."""
    volume = np.clip(np.nan_to_num(np.asarray(volume, float)), 0, None)
    _, group = np.unique(pixel_id, return_inverse=True)
    count = np.bincount(group)
    total_volume = np.bincount(group, weights=volume)
    pixel_value = np.asarray(pixel_qf, float)
    weight = np.where(total_volume[group] > 0, volume / np.where(total_volume[group] > 0, total_volume[group], 1),
                      1.0 / count[group])
    return pixel_value * count[group] * weight


# ===================================================================================================================
# Assembly
# ===================================================================================================================

def load_cells(data_dir: Path, city_id: str) -> tuple:
    document = json.loads((Path(data_dir) / f"{city_id}.json").read_text(encoding="utf-8"))
    cells = document["cells"]
    table = {key: np.asarray(values, float) for key, values in cells["values"].items()}
    table.update(lon=np.asarray(cells["lon"], float), lat=np.asarray(cells["lat"], float),
                 lst=np.asarray(cells["lst"], float))
    return document, table


def cell_index(grid: Grid, lon, lat) -> tuple:
    x, y = Transformer.from_crs(WGS84, grid.crs, always_xy=True).transform(lon, lat)
    row, col, inside = grid.cell_index(np.asarray(x), np.asarray(y))
    if not inside.all():
        raise ValueError(f"{(~inside).sum()} cells fall outside the rebuilt grid")
    return row, col


def build(city_id: str, data_dir: Path = DATA_DIR, cache_root: Path = CACHE_ROOT,
          moisture: bool = None) -> tuple:
    """(SebInputs, Forcing, observed LST in K, inside-the-outline mask) for the cells of `<data_dir>/<id>.json`.

    `moisture` (default USE_SURFACE_MOISTURE): per-cell soil moisture and irrigation from Sentinel-2 SWIR (OPTRAM W)
    instead of one ERA5-Land value and the outline rule; cells without W keep those."""
    moisture = USE_SURFACE_MOISTURE if moisture is None else moisture
    document, cells = load_cells(data_dir, city_id)
    city = get_city(city_id)
    bbox, _ = boundary.city_extent(city)
    grid = Grid.from_bbox(bbox, document["grid"]["cellSizeM"])
    row, col = cell_index(grid, cells["lon"], cells["lat"])
    cache = Cache(Path(cache_root) / "seb" / f"{city_id}_{grid.key()}")
    query_bbox = grid.bbox_lonlat()

    water = _cached_layer(cache, "worldcover_water", lambda: fetch_water_share(query_bbox, grid), row, col)
    if water is None:
        log.warning("%s: WorldCover water unavailable, water share from the mean water distance", city_id)
        water = water_share_from_distance(cells["water_dist"])
    roads = _cached_layer(cache, "osm_road_area", lambda: fetch_road_area(query_bbox, grid), row, col)
    if roads is None:
        log.warning("%s: OSM roads unavailable, road area = density × %.0f m", city_id, FALLBACK_ROAD_WIDTH_M)
        roads = cells["roads"] * 1000.0 * FALLBACK_ROAD_WIDTH_M / 1e6

    fraction = tile_fractions(cells["tree"], cells["built"], cells["bare"], water,
                              roof_share(cells["volume"], cells["height"]), roads, ndvi=cells.get("ndvi"))

    moments = cache.get_or_compute(
        "landsat_times", lambda: weather.landsat_moments(tuple(document["city"]["bbox"]), document["period"]["label"]))
    lon_c, lat_c = document["city"]["center"]
    start, end = (m.strftime("%Y-%m-%d") for m in (min(map(_utc_naive, moments)), max(map(_utc_naive, moments))))
    series = cache.get_or_compute("era5", lambda: era5.hourly(lon_c, lat_c, start, end, variables=ERA5_VARIABLES,
                                                              model="era5", timezone="GMT"))
    land = cache.get_or_compute("era5_land", lambda: era5.hourly(lon_c, lat_c, start, end,
                                                                 variables=ERA5_LAND_VARIABLES, model="era5_land",
                                                                 timezone="GMT"))
    era = at_moments(series, moments, ERA5_VARIABLES)
    soil = at_moments(land, moments, ERA5_LAND_VARIABLES)["soil_moisture_0_to_7cm"]
    force = forcing(era, series["elevation"], cells["elevation"], (lon_c, lat_c), moments)

    side = building_side(fraction[:, TILE["roof"]], cells["buildings"])
    _, lambda_p = urban_patch(fraction)
    aspect = canyon_aspect(cells["height"], lambda_p, side)
    z0m, zd = roughness(fraction, cells["height"], side)
    capped = zd + z0m > 0.8 * Z_REF_M
    if capped.any():
        log.warning("%s: %d cells with zd + z0 above 0.8·z_ref, capped", city_id, capped.sum())
        zd = np.minimum(zd, 0.8 * Z_REF_M - z0m)

    pix_row, pix_col = ah4guc_index(cells["lon"], cells["lat"])
    window = (int(pix_row.min()), int(pix_row.max()), int(pix_col.min()), int(pix_col.max()))
    qf_1km = cache.get_or_compute(f"ah4guc_{window[0]}_{window[1]}_{window[2]}_{window[3]}",
                                  lambda: fetch_ah4guc(window))
    pixel_qf = qf_1km[pix_row - window[0], pix_col - window[2]]
    qf = redistribute_by_volume(pixel_qf, pix_row * 100_000 + pix_col, cells["volume"])

    outline = boundary.load(city_id)
    inside = boundary.inside(outline, cells["lon"], cells["lat"])
    n = len(cells["lst"])
    wetness = np.full(n, np.nan)
    if moisture:
        layer = _cached_moisture(cache, query_bbox, grid)
        if layer is None:
            log.warning("%s: Sentinel-2 surface moisture unavailable, ERA5-Land soil moisture everywhere", city_id)
        else:
            wetness = layer_wetness(layer)[row, col]
    soil_moisture, irrigated = cell_moisture(wetness, soil, inside | (cells["ndvi"] > IRRIGATED_RING_NDVI),
                                             anchor=MOISTURE_ANCHOR_ERA5, vegetation=MOISTURE_DRIVES_VEGETATION)
    inputs = SebInputs(
        fraction=fraction,
        albedo=albedo_matrix(cells["albedo"], fraction),
        emissivity=emissivity_matrix(n),
        shade=shade_matrix(aspect, force.zenith),
        sky_view=sky_view(aspect),
        z0m=z0m,
        zd=zd,
        soil_moisture=soil_moisture,
        irrigated=irrigated,
        ohm=ohm_matrix(n),
        qf=qf,
        rural=~inside,
    )
    _write_summary(cache.root.parent / f"{city_id}_summary.json", inputs, force, era, soil, qf_1km, pixel_qf,
                   aspect, cells, inside, moments, series["elevation"])
    return inputs, force, cells["lst"] + KELVIN, inside


# Irrigation: inside the outline the city waters its greenery (arik network, sprinklers), so every vegetated tile
# there is unstressed; in the ring only crops green enough to be watered in midsummer in this climate (NDVI > 0.45;
# rain-fed land is dry and brown by July). The flag only matters for the vegetated tiles.
IRRIGATED_RING_NDVI = 0.45


def _cached_moisture(cache: Cache, bbox: tuple, grid: Grid):
    try:
        return cache.get_or_compute("sentinel2_moisture", lambda: fetch_surface_moisture(bbox, grid))
    except Exception as error:  # an optional download must not stop the city
        log.warning("sentinel2_moisture failed: %s", error)
        return None


def _cached_layer(cache: Cache, name: str, compute, row, col):
    try:
        layer = cache.get_or_compute(name, compute)
    except Exception as error:  # an optional download must not stop the city
        log.warning("%s failed: %s", name, error)
        return None
    return None if layer is None else np.nan_to_num(np.asarray(layer, float)[row, col])


def _stats(values) -> dict:
    v = np.asarray(values, float)
    return {"mean": round(float(v.mean()), 4), "min": round(float(v.min()), 4),
            "p10": round(float(np.percentile(v, 10)), 4), "p50": round(float(np.percentile(v, 50)), 4),
            "p90": round(float(np.percentile(v, 90)), 4), "max": round(float(v.max()), 4)}


def summary(inputs: SebInputs, force: Forcing) -> dict:
    """Distribution of every input, for the log and the report."""
    out = {"cells": len(inputs.z0m)}
    for tile in TILES:
        k = TILE[tile]
        out[f"fraction.{tile}"] = _stats(inputs.fraction[:, k])
    for tile in ("roof", *[t for t in NATURAL_ALBEDO]):
        out[f"albedo.{tile}"] = _stats(inputs.albedo[:, TILE[tile]])
    out["shade.road"] = _stats(inputs.shade[:, TILE["road"]])
    for key in ("sky_view", "z0m", "zd", "soil_moisture", "qf"):
        out[key] = _stats(getattr(inputs, key))
    out["irrigated_share"] = round(float(inputs.irrigated.mean()), 4)
    out["rural_share"] = round(float(inputs.rural.mean()), 4)
    for key in ("k_down", "diffuse_fraction", "l_down", "t_air", "e_air", "pressure", "wind"):
        out[f"forcing.{key}"] = _stats(getattr(force, key))
    out["forcing.z_ref"] = force.z_ref
    out["forcing.zenith_deg"] = round(math.degrees(force.zenith), 2)
    out["forcing.dk_dt"] = round(force.dk_dt, 2)
    return out


def _write_summary(path: Path, inputs, force, era, soil, qf_1km, pixel_qf, aspect, cells, inside, moments,
                   ref_elevation) -> None:
    report = summary(inputs, force)
    report["canyon_aspect"] = _stats(aspect)
    report["era5_overpass"] = {k: (round(v, 3) if isinstance(v, float) else v) for k, v in era.items()}
    report["era5_reference_elevation_m"] = ref_elevation
    report["soil_moisture_era5_land"] = round(soil, 4)
    report["overpass_moments"] = len(moments)
    report["qf"] = {"label": QF_LABEL, "source": QF_SOURCE, "ah4guc_window": _stats(qf_1km),
                    "ah4guc_at_cells": _stats(pixel_qf), "cells_inside": _stats(inputs.qf[inside]),
                    "cells_ring": _stats(inputs.qf[~inside]) if (~inside).any() else None}
    report["albedo_inversion_clipped_share"] = round(float(np.mean(
        np.isin(inputs.albedo[:, TILE["roof"]], IMPERVIOUS_ALBEDO_RANGE))), 4)
    report["cell_albedo_s2"] = _stats(cells["albedo"])
    path.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    log.info("input summary written to %s", path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the physics model inputs of a city and print their summary")
    parser.add_argument("--city", default="tashkent")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    inputs, force, _, _ = build(args.city)
    print(json.dumps(summary(inputs, force), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
