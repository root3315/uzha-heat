"""City extent from its OSM boundary (GeoJSON in pipeline/boundaries/<city>.geojson).

The analysis bbox is the boundary's extent plus a margin, so the grid covers the whole city
instead of a hand-typed box; cells farther than the margin outside the boundary are dropped.
"""
import json
import logging
from pathlib import Path
from typing import Optional

import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform, unary_union

from .grid import WGS84, utm_crs_for

log = logging.getLogger(__name__)

BOUNDARIES_DIR = Path(__file__).resolve().parent.parent / "boundaries"
MARGIN_M = 1500.0


def load(city_id: str, directory: Path = BOUNDARIES_DIR):
    """The city's boundary as a shapely geometry in lon/lat, or None if there is no file."""
    path = Path(directory) / f"{city_id}.geojson"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    features = data["features"] if data.get("type") == "FeatureCollection" else [data]
    geometries = [shape(f["geometry"] if "geometry" in f else f) for f in features]
    boundary = unary_union(geometries)
    return None if boundary.is_empty else boundary


def buffered(boundary, margin_m: float = MARGIN_M):
    """The boundary grown by `margin_m` metres (computed in its UTM zone), back in lon/lat."""
    center = boundary.centroid
    crs = utm_crs_for(center.x, center.y)
    to_utm = Transformer.from_crs(WGS84, crs, always_xy=True).transform
    to_wgs = Transformer.from_crs(crs, WGS84, always_xy=True).transform
    return transform(to_wgs, transform(to_utm, boundary).buffer(margin_m))


def city_extent(city, margin_m: float = MARGIN_M, directory: Path = BOUNDARIES_DIR) -> tuple:
    """(bbox, area): bbox from the boundary + margin, area = the buffered boundary for cell
    filtering. Falls back to the configured bbox and no area if the boundary file is missing."""
    boundary = load(city.id, directory)
    if boundary is None:
        log.warning("%s: no boundary file, using configured bbox %s", city.id, city.bbox)
        return city.bbox, None
    area = buffered(boundary, margin_m)
    return tuple(float(v) for v in area.bounds), area


def inside(area: Optional[object], lon, lat) -> np.ndarray:
    """Mask of points inside `area` (all True when there is no area)."""
    lon = np.asarray(lon)
    if area is None:
        return np.ones(lon.shape, dtype=bool)
    return shapely.contains_xy(area, lon, np.asarray(lat))
