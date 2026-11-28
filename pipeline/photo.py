"""Satellite photo for the map: a cloud-free summer Sentinel-2 picture of each city, in true colour, 10 m.

Usage (from the project root):
    python -m pipeline.photo              # all cities
    python -m pipeline.photo --city samarkand

The median of the clearest summer scenes (the same Sentinel-2 L2A the greenery comes from), pixel by pixel over the
cloud-free ones, on the Web Mercator grid of the land cover. Writes web/public/data/photo/<city>.webp and
<city>.json (its corners). The site shows it at once and lays the sharper Esri photo over it when that loads.
"""
import argparse
import json
import logging
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image
from rasterio.enums import Resampling
from rasterio.errors import RasterioIOError
from rasterio.warp import transform_bounds

from .landcover import MERCATOR, mercator_raster
from .uzha import boundary
from .uzha.cities import CITIES, City, get_city
from .uzha.grid import WGS84, Raster
from .uzha.sources.sentinel import SCL_CLEAR, _find_scenes, _scene_rank, to_reflectance
from .uzha.stac import parallel_map, read_to_raster

PIPELINE_DIR = Path(__file__).resolve().parent
OUT_DIR = PIPELINE_DIR.parent / "web" / "public" / "data" / "photo"

RGB = ("B04", "B03", "B02")
SCENES_PER_TILE = 6
# Reflectance stretched to the picture: the darkest and brightest 0.5 % clip, a gamma lifts the shadows.
STRETCH_PERCENTILES = (0.5, 99.5)
GAMMA = 1 / 1.4
SATURATION = 1.25
WEBP_QUALITY = 80
READ_ATTEMPTS = 3

log = logging.getLogger("uzha")


def clearest_scenes(bbox: tuple) -> list:
    """The few clearest summer scenes of each Sentinel-2 tile over the city."""
    by_tile = defaultdict(list)
    for item in _find_scenes(bbox):
        by_tile[item.properties["s2:mgrs_tile"]].append(item)
    return [item for items in by_tile.values() for item in sorted(items, key=_scene_rank)[:SCENES_PER_TILE]]


def retried(read, what: str):
    """`read()`, again when the connection drops; None when it keeps failing (a median of the rest is fine)."""
    for attempt in range(1, READ_ATTEMPTS + 1):
        try:
            return read()
        except RasterioIOError as error:
            log.warning("%s: read failed (%d/%d): %s", what, attempt, READ_ATTEMPTS, error)
    return None


def clear_mask(item, raster: Raster):
    """Where the scene sees the ground: no cloud, shadow, snow or missing data (SCL); None if it cannot be read."""
    scl = retried(lambda: read_to_raster(item.assets["SCL"].href, raster, Resampling.nearest, nodata=0), item.id)
    return None if scl is None else np.isin(scl, SCL_CLEAR)


def band_median(items: list, masks: list, band: str, raster: Raster) -> np.ndarray:
    """Median surface reflectance of one band over the scenes, each where it is clear; float32, NaN where none is."""
    def read(pair):
        item, clear = pair
        dn = retried(lambda: read_to_raster(item.assets[band].href, raster, Resampling.bilinear, nodata=0), item.id)
        if dn is None:
            return None
        return np.where(clear, to_reflectance(dn, item.properties["s2:processing_baseline"]), np.nan).astype(np.float32)

    layers = [layer for layer in parallel_map(read, list(zip(items, masks))) if layer is not None]
    with np.errstate(all="ignore"):
        return np.nanmedian(np.stack(layers), axis=0)


def tone(rgb: np.ndarray) -> np.ndarray:
    """Reflectance (3, rows, cols) to 8-bit colour (rows, cols, 3): one stretch for all bands, gamma, a little colour."""
    low, high = np.nanpercentile(rgb[:, ::4, ::4], STRETCH_PERCENTILES)
    scaled = np.clip((np.nan_to_num(rgb, nan=low) - low) / (high - low), 0.0, 1.0) ** GAMMA
    grey = scaled.mean(axis=0, keepdims=True)
    coloured = np.clip(grey + (scaled - grey) * SATURATION, 0.0, 1.0)
    return (np.moveaxis(coloured, 0, -1) * 255 + 0.5).astype(np.uint8)


def build(city: City) -> None:
    bbox, _ = boundary.city_extent(city, margin_m=0)
    raster = mercator_raster(bbox)
    items = clearest_scenes(bbox)
    log.info("%s: %d Sentinel-2 scenes on %d x %d px", city.id, len(items), *raster.shape[::-1])
    # One band at a time over all scenes: a whole city in three bands of six scenes does not fit in memory at once.
    masks = [clear_mask(item, raster) for item in items]
    items, masks = [i for i, m in zip(items, masks) if m is not None], [m for m in masks if m is not None]
    if not items:
        raise RuntimeError(f"{city.id}: no Sentinel-2 scene could be read")
    rgb = np.stack([band_median(items, masks, band, raster) for band in RGB])
    used = len(items)
    del masks

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(tone(rgb), mode="RGB").save(OUT_DIR / f"{city.id}.webp", quality=WEBP_QUALITY, method=6)
    west, south, east, north = transform_bounds(MERCATOR, WGS84, *raster.bounds)
    meta = {
        "source": f"Copernicus Sentinel-2 L2A, summer median of {used} scenes (10 m)",
        "corners": [[west, north], [east, north], [east, south], [west, south]],
    }
    (OUT_DIR / f"{city.id}.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    log.info("%s: %.1f MB", city.id, (OUT_DIR / f"{city.id}.webp").stat().st_size / 1e6)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--city", choices=sorted(CITIES), help="one city; all when left out")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    for city in [get_city(args.city)] if args.city else CITIES.values():
        build(city)


if __name__ == "__main__":
    main()
