"""Land cover for the map: what covers the ground, 10 m, as one picture per city.

Usage (from the project root):
    python -m pipeline.landcover              # all cities
    python -m pipeline.landcover --city samarkand

Reads ESA WorldCover 2021 from Planetary Computer, reprojects it to Web Mercator so the picture lies on the map
as it is, paints each class in the site's colours and leaves everything outside the city transparent. Writes
web/public/data/landcover/<city>.png and <city>.json (corners and each class's share of the city).
"""
import argparse
import json
import logging
import math
from pathlib import Path

import numpy as np
import shapely
from affine import Affine
from PIL import Image
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.features import geometry_mask
from rasterio.warp import transform_bounds, transform_geom

from .uzha import boundary
from .uzha.cities import CITIES, City, get_city
from .uzha.grid import WGS84, Raster
from .uzha.sources import worldcover

PIPELINE_DIR = Path(__file__).resolve().parent
OUT_DIR = PIPELINE_DIR.parent / "web" / "public" / "data" / "landcover"

MERCATOR = CRS.from_epsg(3857)
GROUND_RES_M = 10.0

# WorldCover code -> key used by the site, and its colour. Rare classes fold into the nearest common one.
CLASSES = {
    10: ("trees", (63, 125, 78)),
    20: ("shrubs", (155, 179, 106)),
    30: ("grass", (196, 216, 138)),
    40: ("cropland", (227, 217, 160)),
    50: ("built", (138, 143, 153)),
    60: ("bare", (216, 203, 184)),
    70: ("bare", (216, 203, 184)),
    80: ("water", (111, 164, 200)),
    90: ("wetland", (95, 156, 151)),
    95: ("wetland", (95, 156, 151)),
    100: ("grass", (196, 216, 138)),
}

KEYS = list(dict.fromkeys(key for key, _ in CLASSES.values()))
COLOURS = {key: colour for key, colour in CLASSES.values()}

log = logging.getLogger("uzha")


def mercator_raster(bbox: tuple) -> Raster:
    """A Web Mercator grid over the bbox whose pixels are about GROUND_RES_M on the ground at the city's latitude."""
    west, south, east, north = bbox
    res = GROUND_RES_M / math.cos(math.radians((south + north) / 2))
    left, bottom, right, top = transform_bounds(WGS84, MERCATOR, west, south, east, north)
    cols, rows = math.ceil((right - left) / res), math.ceil((top - bottom) / res)
    return Raster(crs=MERCATOR, transform=Affine(res, 0.0, left, 0.0, -res, top), shape=(rows, cols))


def paint(codes: np.ndarray, inside: np.ndarray) -> tuple:
    """Palette picture of the classes (index 0 transparent) and each class's share of the pixels inside."""
    index = np.zeros(codes.shape, dtype=np.uint8)
    for code, (key, _) in CLASSES.items():
        index[(codes == code) & inside] = KEYS.index(key) + 1
    counted = index[index > 0]
    shares = {key: float(np.mean(counted == i + 1)) if counted.size else 0.0 for i, key in enumerate(KEYS)}
    palette = [0, 0, 0] + [channel for key in KEYS for channel in COLOURS[key]]
    picture = Image.fromarray(index, mode="P")
    picture.putpalette(palette)
    picture.info["transparency"] = 0
    legend = [{"key": key, "color": "#%02x%02x%02x" % COLOURS[key], "share": round(shares[key], 4)} for key in KEYS if shares[key] > 0]
    return picture, legend


def build(city: City) -> None:
    bbox, area = boundary.city_extent(city, margin_m=0)
    raster = mercator_raster(bbox)
    log.info("%s: WorldCover on %d x %d px", city.id, *raster.shape[::-1])
    codes = worldcover.land_cover(bbox, raster)
    if area is None:
        inside = codes != worldcover.NO_DATA
    else:
        shape = transform_geom(WGS84, MERCATOR, shapely.geometry.mapping(area))
        inside = geometry_mask([shape], out_shape=raster.shape, transform=raster.transform, invert=True)
    picture, legend = paint(codes, inside)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    picture.save(OUT_DIR / f"{city.id}.png", optimize=True)
    west, south, east, north = transform_bounds(MERCATOR, WGS84, *raster.bounds)
    meta = {
        "source": "ESA WorldCover 2021 (10 m)",
        "corners": [[west, north], [east, north], [east, south], [west, south]],
        "classes": legend,
    }
    (OUT_DIR / f"{city.id}.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    log.info("%s: %s", city.id, ", ".join(f"{c['key']} {c['share']:.0%}" for c in legend))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--city", choices=sorted(CITIES), help="one city; all when left out")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    for city in [get_city(args.city)] if args.city else CITIES.values():
        build(city)


if __name__ == "__main__":
    main()
