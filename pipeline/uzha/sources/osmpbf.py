"""OSM building footprints from the Geofabrik extract of Uzbekistan, read with GDAL's OSM driver.

Overpass serves building centres well, but full outlines of a whole city (hundreds of thousands of
polygons) time out on the public servers; the country extract is ~130 MB and is read locally instead.
"""
import logging
import re
from pathlib import Path

import numpy as np
import pyogrio
import shapely

from .osm import tagged_height
from ..download import download_to

log = logging.getLogger(__name__)

EXTRACT_URL = "https://download.geofabrik.de/asia/uzbekistan-latest.osm.pbf"
EXTRACT_NAME = "uzbekistan-latest.osm.pbf"
DOWNLOAD_TIMEOUT_S = (30, 1800)
#: GDAL keeps tags it has no column for in one hstore string: "key"=>"value","key2"=>"value2"
HSTORE_PAIR = re.compile(r'"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"')


def download(cache_dir: Path) -> Path:
    """The country extract in `cache_dir`, downloaded once."""
    return download_to(EXTRACT_URL, Path(cache_dir) / EXTRACT_NAME, DOWNLOAD_TIMEOUT_S)


def other_tags(hstore) -> dict:
    """Tags from GDAL's `other_tags` column."""
    return dict(HSTORE_PAIR.findall(hstore)) if isinstance(hstore, str) else {}


def footprints(path: Path, bbox: tuple) -> tuple:
    """(polygons in lon/lat, building type, tagged height in m or NaN) for buildings in `bbox`.

    Ways and multipolygon relations both come in GDAL's `multipolygons` layer.
    """
    _, _, geometry, fields = pyogrio.raw.read(
        path, layer="multipolygons", bbox=bbox, columns=["building", "other_tags"], where="building IS NOT NULL AND building <> 'no'",
    )
    polygons = shapely.from_wkb(geometry)
    kinds = np.asarray(fields[0], dtype=object)
    heights = np.array([_height(hstore) for hstore in fields[1]], dtype=float)
    return polygons, kinds, heights


def _height(hstore) -> float:
    metres = tagged_height(other_tags(hstore))
    return np.nan if metres is None else metres


def roads(path: Path, bbox: tuple, types: str) -> list:
    """Ways tagged `highway=<type>` or `<type>_link` (types `a|b|…`) crossing `bbox`, in the Overpass `out geom` shape
    ({"tags", "geometry": [{"lon", "lat"}, …]}), so the same road code reads either source."""
    kinds = [kind for base in types.split("|") for kind in (base, f"{base}_link")]
    where = "highway IN ({})".format(",".join(f"'{kind}'" for kind in kinds))
    _, _, geometry, fields = pyogrio.raw.read(path, layer="lines", bbox=bbox, columns=["highway", "other_tags"],
                                              where=where)
    elements = []
    for line, highway, hstore in zip(shapely.from_wkb(geometry), fields[0], fields[1]):
        coords = shapely.get_coordinates(line)
        elements.append({"tags": {**other_tags(hstore), "highway": highway},
                         "geometry": [{"lon": lon, "lat": lat} for lon, lat in coords]})
    return elements
