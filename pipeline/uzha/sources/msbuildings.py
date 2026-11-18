"""Microsoft Global ML Building Footprints (Planetary Computer collection "ms-buildings").

The collection is a Delta table on Azure Blob storage partitioned by region and level-9 quadkey; each
STAC item points at one partition folder. The parquet files there are listed through the Blob REST API
with a Planetary Computer SAS token and downloaded once into the cache (~45 MB per quadkey).
Its `meanHeight` column is −1 throughout Uzbekistan, so only the footprints are used.
"""
import logging
import re
from pathlib import Path

import numpy as np
import planetary_computer
import pyarrow.parquet as pq
import requests
import shapely
from pystac_client.exceptions import APIError

from ..stac import search

log = logging.getLogger(__name__)

COLLECTION = "ms-buildings"
ACCOUNT = "bingmlbuildings"
BLOB_ROOT = f"https://{ACCOUNT}.blob.core.windows.net"
#: abfs://<container>/<prefix>, the item's partition folder
PARTITION_HREF = re.compile(r"^abfs://(?P<container>[^/]+)/(?P<prefix>(?:.*/)?delta/(?P<date>[\d-]+)/.*quadkey=\d+)/?$")
DOWNLOAD_TIMEOUT_S = (30, 900)
LIST_TIMEOUT_S = 60
CHUNK_BYTES = 1 << 20


def partitions(items: list) -> list:
    """(container, prefix) of the newest Delta release's quadkey partitions among STAC items.

    The collection also holds older whole-region snapshots; those overlap the Delta table and are skipped.
    """
    found = []
    for item in items:
        match = PARTITION_HREF.match(item.assets["data"].href) if "data" in item.assets else None
        if match:
            found.append((match["date"], match["container"], match["prefix"]))
    if not found:
        return []
    newest = max(date for date, _, _ in found)
    return sorted({(container, prefix) for date, container, prefix in found if date == newest})


def _blob_names(container: str, prefix: str, token: str) -> list:
    url = f"{BLOB_ROOT}/{container}?restype=container&comp=list&prefix={prefix}/&{token}"
    response = requests.get(url, timeout=LIST_TIMEOUT_S)
    response.raise_for_status()
    return [name for name in re.findall(r"<Name>(.*?)</Name>", response.text) if name.endswith(".parquet")]


def _download(container: str, name: str, token: str, cache_dir: Path) -> Path:
    path = Path(cache_dir) / name.replace("/", "_").replace("=", "-")
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    log.info("downloading %s", name)
    partial = path.with_suffix(".part")
    with requests.get(f"{BLOB_ROOT}/{container}/{name}?{token}", stream=True, timeout=DOWNLOAD_TIMEOUT_S) as response:
        response.raise_for_status()
        with partial.open("wb") as f:
            for chunk in response.iter_content(CHUNK_BYTES):
                f.write(chunk)
    partial.replace(path)
    return path


def download(bbox: tuple, cache_dir: Path) -> list:
    """Paths of the cached parquet files covering `bbox`."""
    paths = []
    for container, prefix in partitions(search(COLLECTION, bbox)):
        token = planetary_computer.sas.get_token(ACCOUNT, container).token
        paths += [_download(container, name, token, cache_dir) for name in _blob_names(container, prefix, token)]
    return paths


def read(paths: list, bbox: tuple) -> np.ndarray:
    """Footprints (shapely polygons, lon/lat) whose box intersects `bbox`."""
    parts = []
    for path in paths:
        geometry = shapely.from_wkb(pq.read_table(path, columns=["geometry"]).column("geometry").to_numpy(zero_copy_only=False))
        parts.append(geometry[shapely.intersects(geometry, shapely.box(*bbox))])
    return np.concatenate(parts) if parts else np.empty(0, dtype=object)


def footprints(bbox: tuple, cache_dir: Path):
    """MS footprints inside `bbox`, or None when the collection cannot be reached."""
    try:
        return read(download(bbox, cache_dir), bbox)
    except (requests.RequestException, OSError, APIError) as error:
        log.warning("ms-buildings unavailable: %s", error)
        return None
