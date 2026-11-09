"""OpenStreetMap layers via the Overpass API: roads, buildings, water, district boundaries."""
import json
import logging
import time

import numpy as np
import requests
from pyproj import Transformer
from rasterio.features import rasterize
from shapely.geometry import LineString, Polygon
from shapely.ops import polygonize, unary_union

from ..grid import WGS84, Grid, Raster

log = logging.getLogger(__name__)

OVERPASS_URLS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
)
USER_AGENT = "uzha-heat-pipeline/0.1"
TIMEOUT_S = 180  # hard cap per request: Overpass server timeout and client wall clock
CONNECT_TIMEOUT_S = 30
CHUNK_BYTES = 1 << 16
RETRY_ROUNDS = 2
RETRY_BASE_DELAY_S = 15
RETRY_MAX_DELAY_S = 240
BUILDING_TILES = 3
ROAD_TYPES = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service"
SAMPLE_STEP_M = 10.0
CELL_AREA_KM2_PER_M2 = 1e-6
CELL_AREA_HA_PER_M2 = 1e-4


def overpass(query: str, rounds: int = RETRY_ROUNDS, sleep=time.sleep):
    """Run an Overpass query, cycling through the mirrors for `rounds` rounds with exponential
    backoff between attempts; returns the element list or None if every attempt failed."""
    body = f"[out:json][timeout:{TIMEOUT_S}];{query}"
    attempts = [url for _ in range(rounds) for url in OVERPASS_URLS]
    for attempt, url in enumerate(attempts, start=1):
        try:
            return _overpass_once(url, body)
        except (requests.RequestException, ValueError, KeyError) as error:
            log.warning("Overpass attempt %d/%d (%s) failed: %s", attempt, len(attempts), url, error)
            if attempt < len(attempts):
                sleep(retry_delay(attempt))
    return None


def retry_delay(attempt: int) -> float:
    """Seconds to wait after the given (1-based) failed attempt."""
    return min(RETRY_BASE_DELAY_S * 2 ** (attempt - 1), RETRY_MAX_DELAY_S)


def _overpass_once(url: str, body: str, timeout_s: float = TIMEOUT_S) -> list:
    """One request with a wall-clock cap: `requests` alone only bounds each socket read, so a
    server trickling bytes could otherwise hold the pipeline indefinitely."""
    deadline = time.monotonic() + timeout_s
    with requests.post(url, data={"data": body}, headers={"User-Agent": USER_AGENT},
                       timeout=(CONNECT_TIMEOUT_S, timeout_s), stream=True) as response:
        response.raise_for_status()
        chunks = []
        for chunk in response.iter_content(CHUNK_BYTES):
            if time.monotonic() > deadline:
                raise requests.Timeout(f"no complete response within {timeout_s:g} s")
            chunks.append(chunk)
    payload = json.loads(b"".join(chunks))
    remark = payload.get("remark", "")
    if "runtime error" in remark or "timed out" in remark:
        raise ValueError(f"incomplete result: {remark}")
    return payload["elements"]


def overpass_bbox(bbox: tuple) -> str:
    west, south, east, north = bbox
    return f"({south},{west},{north},{east})"


def fetch_roads(bbox: tuple):
    return overpass(f'way["highway"~"^({ROAD_TYPES})(_link)?$"]{overpass_bbox(bbox)};out geom;')


def fetch_buildings(bbox: tuple, tiles: int = BUILDING_TILES):
    """Building centers, fetched in tiles x tiles parts (one large query times out on busy servers)."""
    by_id = {}
    for part in split_bbox(bbox, tiles):
        b = overpass_bbox(part)
        elements = overpass(f'(way["building"]{b};relation["building"]{b};);out center;')
        if elements is None:
            return None
        by_id.update(((el["type"], el["id"]), el) for el in elements)
    return list(by_id.values())


def split_bbox(bbox: tuple, tiles: int) -> list:
    west, south, east, north = bbox
    lons = [west + (east - west) * i / tiles for i in range(tiles + 1)]
    lats = [south + (north - south) * j / tiles for j in range(tiles + 1)]
    return [(lons[i], lats[j], lons[i + 1], lats[j + 1]) for i in range(tiles) for j in range(tiles)]


def fetch_water(bbox: tuple):
    b = overpass_bbox(bbox)
    return overpass(
        f'(way["natural"="water"]{b};relation["natural"="water"]{b};'
        f'way["landuse"="reservoir"]{b};way["waterway"~"^(river|canal)$"]{b};);out geom;'
    )


def fetch_districts(relation_id: int, admin_level: int, bbox: tuple):
    """The city relation plus all admin relations of `admin_level` touching the bbox."""
    return overpass(
        f"(rel({relation_id});"
        f'rel["boundary"="administrative"]["admin_level"="{admin_level}"]{overpass_bbox(bbox)};);out geom;'
    )


def road_density(elements: list, grid: Grid) -> np.ndarray:
    """Road length per cell, km/km²."""
    to_utm = Transformer.from_crs(WGS84, grid.crs, always_xy=True)
    lines = [_project(to_utm, el["geometry"]) for el in elements if len(el.get("geometry", ())) >= 2]
    length_m = line_length_per_cell(grid, lines)
    return length_m / 1000.0 / (grid.cell_size ** 2 * CELL_AREA_KM2_PER_M2)


def building_density(elements: list, grid: Grid) -> np.ndarray:
    """Buildings per hectare, counted by footprint center."""
    centers = [el["center"] for el in elements if "center" in el]
    to_utm = Transformer.from_crs(WGS84, grid.crs, always_xy=True)
    x, y = to_utm.transform([c["lon"] for c in centers], [c["lat"] for c in centers])
    return grid.sum_points(np.asarray(x), np.asarray(y)) / (grid.cell_size ** 2 * CELL_AREA_HA_PER_M2)


def line_length_per_cell(grid: Grid, lines: list, step: float = SAMPLE_STEP_M) -> np.ndarray:
    """Total length (m) of polylines (UTM (n, 2) arrays) inside each cell, by dense sampling."""
    segments = [(line[:-1], np.diff(line, axis=0)) for line in lines]
    if not segments:
        return np.zeros(grid.shape)
    starts = np.concatenate([s for s, _ in segments])
    vectors = np.concatenate([v for _, v in segments])
    lengths = np.hypot(vectors[:, 0], vectors[:, 1])
    samples = np.maximum(1, np.ceil(lengths / step)).astype(int)
    segment = np.repeat(np.arange(len(samples)), samples)
    position = np.arange(samples.sum()) - np.repeat(np.cumsum(samples) - samples, samples)
    t = (position + 0.5) / samples[segment]
    points = starts[segment] + vectors[segment] * t[:, None]
    return grid.sum_points(points[:, 0], points[:, 1], (lengths / samples)[segment])


def water_mask(elements: list, raster: Raster) -> np.ndarray:
    """Boolean water raster from OSM water areas (filled) and rivers/canals (center lines)."""
    to_utm = Transformer.from_crs(WGS84, raster.crs, always_xy=True)
    shapes = []
    for coords, is_area in _water_parts(elements):
        xy = _project(to_utm, coords)
        if is_area and len(xy) >= 4 and np.allclose(xy[0], xy[-1]):
            shapes.append(Polygon(xy))
        elif len(xy) >= 2:
            shapes.append(LineString(xy))
    if not shapes:
        return np.zeros(raster.shape, dtype=bool)
    burned = rasterize(((s, 1) for s in shapes), out_shape=raster.shape, transform=raster.transform,
                       fill=0, all_touched=True, dtype="uint8")
    return burned.astype(bool)


def district_polygons(elements: list, relation_id: int) -> list:
    """[(name, shapely polygon)] for districts whose interior lies inside the city boundary."""
    shapes = {el["id"]: _relation_polygon(el) for el in elements if el["type"] == "relation"}
    city = shapes.pop(relation_id, None)
    if city is None or city.is_empty:
        return []
    names = {el["id"]: el["tags"].get("name:ru") or el["tags"].get("name", "") for el in elements
             if el["type"] == "relation"}
    return [(names[rid], shape) for rid, shape in shapes.items()
            if not shape.is_empty and city.contains(shape.representative_point())]


def _water_parts(elements: list):
    for el in elements:
        tags = el.get("tags", {})
        is_area = "waterway" not in tags
        if el["type"] == "way" and "geometry" in el:
            yield el["geometry"], is_area
        elif el["type"] == "relation":
            for member in el.get("members", ()):
                if member.get("type") == "way" and member.get("role") == "outer" and "geometry" in member:
                    yield member["geometry"], is_area


def _relation_polygon(relation: dict):
    outer = [LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
             for m in relation.get("members", ())
             if m.get("type") == "way" and m.get("role") == "outer" and len(m.get("geometry", ())) >= 2]
    return unary_union(list(polygonize(unary_union(outer))))


def _project(transformer: Transformer, coords: list) -> np.ndarray:
    x, y = transformer.transform([p["lon"] for p in coords], [p["lat"] for p in coords])
    return np.column_stack([x, y])
