"""Assemble the per-cell table: LST target plus explanatory factors."""
import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.ndimage import distance_transform_edt

from . import boundary
from .cache import Cache
from .cities import City
from .grid import Grid, aggregate
from .sources import dem, ghsl, landsat, osm, sentinel, worldcover

log = logging.getLogger(__name__)

FINE_FACTOR = 7  # 200 m / 7 ≈ 28.6 m, close to Landsat's 30 m
LANDCOVER_FACTOR = 20  # 10 m, WorldCover's native resolution
MIN_VALID_FRACTION = 0.5
MAX_WATER_FRACTION = 0.5
M2_PER_HA = 10_000.0

FACTORS = {
    "ndvi": ("Растительность", "NDVI",
             "Вегетационный индекс по Sentinel-2, медиана за лето. Выше — больше зелени."),
    "tree": ("Древесный покров", "% площади", "Доля клетки под деревьями, ESA WorldCover 2021."),
    "built": ("Застройка", "% площади", "Доля клетки под застройкой и покрытиями, ESA WorldCover 2021."),
    "bare": ("Открытый грунт", "% площади", "Доля клетки без растительности и застройки, ESA WorldCover 2021."),
    "albedo": ("Отражающая способность", "albedo 0–1",
               "Доля отражённого солнечного излучения, Sentinel-2, формула Liang (2001)."),
    "roads": ("Плотность дорог", "км/км²", "Длина автодорог на км², OpenStreetMap."),
    "buildings": ("Плотность зданий", "шт/га", "Число зданий на гектар, OpenStreetMap."),
    "height": ("Высота зданий", "м",
               "Средняя высота зданий участка: OpenStreetMap (height или этажи × 3 м), где её нет, GHSL Built-H 2018."),
    "volume": ("Объём застройки", "м³/га",
               "Объём зданий на гектар: площадь под зданиями по GHSL Built-S 2020, умноженная на их высоту."),
    "water_dist": ("Удалённость от воды", "м",
                   "Среднее расстояние до воды: водоёмы ESA WorldCover, реки и каналы OpenStreetMap."),
    "elevation": ("Высота", "м", "Высота над уровнем моря, Copernicus DEM GLO-30."),
}


@dataclass
class FeatureTable:
    cells: pd.DataFrame  # one row per kept cell: x, y, lon, lat, lst and factor columns
    factors: list  # factor keys present, in FACTORS order
    lst_scenes: int
    s2_scenes: int
    period_label: str
    dropped: list = field(default_factory=list)


def build(city: City, grid: Grid, cache: Cache, area=None) -> FeatureTable:
    """`area` (lon/lat geometry, optional) limits kept cells to those centred inside it."""
    bbox = grid.bbox_lonlat()
    fine = grid.raster(FINE_FACTOR)
    landcover_raster = grid.raster(LANDCOVER_FACTOR)

    lst = cache.get_or_compute("landsat", lambda: landsat.summer_lst(bbox, fine))
    layers, valid = {}, {}
    layers["lst"], valid["lst"] = aggregate(lst.lst, FINE_FACTOR)

    dropped = []
    surface = _optional(cache, "sentinel2", lambda: sentinel.summer_surface(bbox, fine), dropped, ["ndvi", "albedo"])
    if surface is not None:
        layers["ndvi"], valid["ndvi"] = aggregate(surface.ndvi, FINE_FACTOR)
        layers["albedo"], valid["albedo"] = aggregate(surface.albedo, FINE_FACTOR)

    classes = _optional(cache, "worldcover", lambda: worldcover.land_cover(bbox, landcover_raster), dropped,
                        ["tree", "built", "bare"])
    water_fraction = np.zeros(grid.shape)
    wc_water = np.zeros(landcover_raster.shape, dtype=bool)
    if classes is not None:
        for key, code in (("tree", worldcover.TREE), ("built", worldcover.BUILT), ("bare", worldcover.BARE)):
            share, valid[key] = aggregate(worldcover.class_share(classes, code), LANDCOVER_FACTOR)
            layers[key] = share * 100.0
        water_fraction, _ = aggregate(worldcover.class_share(classes, worldcover.WATER), LANDCOVER_FACTOR)
        wc_water = classes == worldcover.WATER

    roads = cache.get_or_compute("osm_roads", lambda: osm.fetch_roads(bbox))
    if roads is not None:
        layers["roads"] = osm.road_density(roads, grid)
    else:
        dropped.append("roads")
    buildings = cache.get_or_compute("osm_buildings", lambda: osm.fetch_buildings(bbox))
    if buildings is not None:
        layers["buildings"] = osm.building_density(buildings, grid)
    else:
        dropped.append("buildings")

    ghsl_built = _optional(cache, "ghsl", lambda: ghsl.built(bbox, fine, cache.root.parent / "ghsl"), dropped,
                           ["height", "volume"])
    if ghsl_built is not None:
        counts = osm.building_heights(buildings, grid) if buildings is not None else (np.zeros(grid.shape),) * 3
        layers["height"], layers["volume"], valid["height"] = building_form(*ghsl_built, *counts)
        _log_height_coverage(city, counts)

    osm_water = cache.get_or_compute("osm_water", lambda: osm.fetch_water(bbox))
    water = wc_water | (osm.water_mask(osm_water, landcover_raster) if osm_water else False)
    if water.any():
        layers["water_dist"], _ = aggregate(_distance_to(water, landcover_raster.res), LANDCOVER_FACTOR)
    else:
        dropped.append("water_dist")

    elevation = _optional(cache, "dem", lambda: dem.elevation(bbox, fine), dropped, ["elevation"])
    if elevation is not None:
        layers["elevation"], valid["elevation"] = aggregate(elevation, FINE_FACTOR)

    table = _to_table(grid, layers, valid, water_fraction, area)
    factors = [key for key in FACTORS if key in layers]
    log.info("%s: %d of %d cells kept; factors: %s", city.id, len(table), grid.rows * grid.cols, factors)
    return FeatureTable(table, factors, lst.scenes, surface.scenes if surface else 0, lst.period.label, dropped)


def building_form(ghsl_height: np.ndarray, ghsl_share: np.ndarray, counts: np.ndarray, tagged: np.ndarray,
                  tagged_sum: np.ndarray) -> tuple:
    """Per cell: mean building height (m), built volume (m³/ha) and the fraction of GHSL pixels with data.

    Every OSM building counts with its own height where OSM has one; the rest take the cell's GHSL height
    (ANBH weighted by built-up share). A cell without OSM buildings takes the GHSL height. Volume is the
    GHSL built-up share of the cell times that height.
    """
    share, valid = aggregate(ghsl_share, FINE_FACTOR)
    weighted, _ = aggregate(ghsl_share * ghsl_height, FINE_FACTOR)
    with np.errstate(invalid="ignore", divide="ignore"):
        ghsl_cell = np.where(share > 0, weighted / share, 0.0)
        height = np.where(counts > 0, (tagged_sum + (counts - tagged) * ghsl_cell) / np.maximum(counts, 1), ghsl_cell)
    height = np.where(np.isfinite(share), height, np.nan)
    return height, share * height * M2_PER_HA, valid


def _log_height_coverage(city: City, counts: tuple) -> None:
    total, tagged = counts[0].sum(), counts[1].sum()
    log.info("%s: %d of %d OSM buildings (%.1f %%) have a height or levels; the rest take GHSL", city.id,
             tagged, total, 100 * tagged / total if total else 0)


def _optional(cache: Cache, name: str, compute, dropped: list, keys: list):
    try:
        return cache.get_or_compute(name, compute)
    except Exception as error:  # a failed optional source must not stop the city
        log.warning("%s unavailable, dropping %s: %s", name, keys, error)
        dropped.extend(keys)
        return None


def _distance_to(mask: np.ndarray, pixel_size: float) -> np.ndarray:
    return (distance_transform_edt(~mask) * pixel_size).astype(np.float32)


def _to_table(grid: Grid, layers: dict, valid: dict, water_fraction: np.ndarray, area=None) -> pd.DataFrame:
    x, y = grid.cell_centers()
    lon, lat = grid.cell_centers_lonlat()
    table = pd.DataFrame({"x": x.ravel(), "y": y.ravel(), "lon": np.ravel(lon), "lat": np.ravel(lat)})
    for key, layer in layers.items():
        table[key] = layer.ravel()
    keep = water_fraction.ravel() <= MAX_WATER_FRACTION
    keep &= boundary.inside(area, table["lon"].to_numpy(), table["lat"].to_numpy())
    for fraction in valid.values():
        keep &= fraction.ravel() >= MIN_VALID_FRACTION
    keep &= table[list(layers)].notna().all(axis=1).to_numpy()
    return table[keep].reset_index(drop=True)
