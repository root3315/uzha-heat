"""OSM building footprints from the Geofabrik extract of Uzbekistan, read with GDAL's OSM driver.

Overpass serves building centres well, but full outlines of a whole city (hundreds of thousands of
polygons) time out on the public servers; the country extract is ~130 MB and is read locally instead.
"""
import logging
import re
from pathlib import Path

import numpy as np
import pyogrio
import requests
import shapely

from .osm import tagged_height

log = logging.getLogger(__name__)

EXTRACT_URL = "https://download.geofabrik.de/asia/uzbekistan-latest.osm.pbf"
EXTRACT_NAME = "uzbekistan-latest.osm.pbf"
DOWNLOAD_TIMEOUT_S = (30, 1800)
CHUNK_BYTES = 1 << 20
#: GDAL keeps tags it has no column for in one hstore string: "key"=>"value","key2"=>"value2"
HSTORE_PAIR = re.compile(r'"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"')


def download(cache_dir: Path) -> Path:
    """The country extract in `cache_dir`, downloaded once."""
    path = Path(cache_dir) / EXTRACT_NAME
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    log.info("downloading %s", EXTRACT_URL)
    partial = path.with_suffix(".part")
    with requests.get(EXTRACT_URL, stream=True, timeout=DOWNLOAD_TIMEOUT_S) as response:
        response.raise_for_status()
        with partial.open("wb") as f:
            for chunk in response.iter_content(CHUNK_BYTES):
                f.write(chunk)
    partial.replace(path)
    return path


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
