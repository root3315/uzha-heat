"""External check of our Landsat LST against NASA MODIS (MOD11A2 Terra, MYD11A2 Aqua) + day/night heat island.

Reads our per-cell LST from web/public/data/<city>.json, fetches MODIS 8-day 1 km LST for the same summer
period, and writes the comparison to pipeline/cache/validation.json (git-ignored) and stdout.

Usage (from the project root):
    python -m pipeline.validate --all
    python -m pipeline.validate --city tashkent
"""
import argparse
import hashlib
import json
import logging
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely.ops import transform as transform_geometry

from .uzha import boundary
from .uzha.cache import Cache
from .uzha.cities import CITIES, City, get_city
from .uzha.grid import WGS84, utm_crs_for
from .uzha.sources import modis
from .uzha.sources.landsat import PERIODS
from .uzha.validation import (agreement, aggregate_to_pixels, heat_island, outline_position, pixel_centers,
                              ring_mask)

PIPELINE_DIR = Path(__file__).resolve().parent
DATA_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"
CACHE_ROOT = PIPELINE_DIR / "cache"
OUT_PATH = CACHE_ROOT / "validation.json"
WEB_PATH = DATA_DIR / "validation.json"

PERIOD = PERIODS[0]  # June–August 2023–2025, the period of the published Landsat median
MODIS_RING_WIDTHS_M = (1000, 1500, 3000, 5000)
LANDSAT_RING_WIDTHS_M = (500, 1000, 1500)
MODIS_FETCH_MARGIN_M = 8000  # widest ring + a few pixels
MIN_CELLS_PER_PIXEL = 17  # of ~21.5 200 m cells in a 926 m MODIS pixel

log = logging.getLogger("uzha")


def validate_city(city: City) -> dict:
    document = json.loads((DATA_DIR / f"{city.id}.json").read_text(encoding="utf-8"))
    cells = document["cells"]
    lon, lat = np.asarray(cells["lon"], float), np.asarray(cells["lat"], float)
    lst = np.array([np.nan if v is None else v for v in cells["lst"]], dtype=float)

    outline = boundary.load(city.id)
    utm = utm_crs_for(*city.center)
    to_utm = Transformer.from_crs(WGS84, utm, always_xy=True).transform
    outline_utm = transform_geometry(to_utm, outline)

    fetch_bbox = tuple(round(v, 4) for v in boundary.buffered(outline, MODIS_FETCH_MARGIN_M).bounds)
    cache = Cache(CACHE_ROOT / f"modis_{city.id}_{_key(fetch_bbox)}")
    products = {platform: cache.get_or_compute(f"mod11a2_{platform}",
                                               lambda p=platform: modis.summer_lst(fetch_bbox, PERIOD, p))
                for platform in modis.PLATFORMS}
    raster = products["aqua"].raster

    # our cells: rings in UTM, aggregation on the MODIS sinusoidal grid
    cell_inside, cell_distance = outline_position(outline_utm, *to_utm(lon, lat))
    cx, cy = Transformer.from_crs(WGS84, modis.SINUSOIDAL, always_xy=True).transform(lon, lat)
    ours_mean, ours_count = aggregate_to_pixels(cx, cy, lst, raster.transform, raster.shape)
    ours_1km = np.where(ours_count >= MIN_CELLS_PER_PIXEL, ours_mean, np.nan)

    px, py = pixel_centers(raster.transform, raster.shape)
    pixel_x, pixel_y = Transformer.from_crs(modis.SINUSOIDAL, utm, always_xy=True).transform(px, py)
    pixel_inside, pixel_distance = outline_position(outline_utm, pixel_x, pixel_y)

    result = {"landsatScenes": document["period"]["lstScenes"], "cells": int(np.isfinite(lst).sum()),
              "modis": {}, "landsat": {}}
    for platform, product in products.items():
        result["modis"][platform] = {
            "product": modis.PLATFORMS[platform],
            "overpassLocal": modis.OVERPASS_LOCAL[platform],
            "composites": product.composites,
            "dayVsLandsat": _rounded(agreement(ours_1km, product.day)),
            "dayVsLandsatInsideCity": _rounded(agreement(np.where(pixel_inside, ours_1km, np.nan), product.day)),
            "heatIsland": {
                part: {f"{width / 1000:g}km": _rounded(heat_island(
                    getattr(product, part), pixel_inside, ring_mask(pixel_inside, pixel_distance, width)))
                    for width in MODIS_RING_WIDTHS_M}
                for part in modis.BANDS
            },
        }
    result["landsat"]["heatIsland"] = {
        f"{width / 1000:g}km": _rounded(heat_island(lst, cell_inside, ring_mask(cell_inside, cell_distance, width)))
        for width in LANDSAT_RING_WIDTHS_M
    }
    result["landsat"]["heatIslandAt1kmPixels"] = {
        "1.5km": _rounded(heat_island(ours_1km, pixel_inside, ring_mask(pixel_inside, pixel_distance, 1500)))
    }
    return result


def _key(bbox: tuple) -> str:
    return hashlib.sha1(repr((bbox, PERIOD.label)).encode()).hexdigest()[:8]


def _rounded(value):
    if value is None:
        return None
    return {k: (round(v, 2) if isinstance(v, float) else v) for k, v in value.items()}


def _print_table(results: dict) -> None:
    for city_id, res in results.items():
        print(f"\n== {city_id}  (Landsat scenes {res['landsatScenes']}, cells {res['cells']})")
        for platform, m in res["modis"].items():
            a = m["dayVsLandsat"]
            print(f"  {m['product']} day {m['overpassLocal']['day']}: r={a['r']} bias={a['bias']} "
                  f"rmse={a['rmse']} n={a['n']}  (composites {m['composites']})")
            for part, rings in m["heatIsland"].items():
                print(f"    UHI {part:5s} " + "  ".join(
                    f"{w}: {r['intensity'] if r else None}" for w, r in rings.items()))
        print("  Landsat UHI " + "  ".join(
            f"{w}: {r['intensity'] if r else None}" for w, r in res["landsat"]["heatIsland"].items()))


def web_summary(report: dict) -> dict:
    """What the site shows: day agreement with each MODIS platform and the MODIS heat island by day and night per ring."""
    def platform(p: dict) -> dict:
        island = {when: {width: (ring["intensity"] if ring else None) for width, ring in rings.items()}
                  for when, rings in p["heatIsland"].items()}
        return {"product": p["product"], "overpassLocal": p["overpassLocal"], "composites": p["composites"],
                "day": p["dayVsLandsat"], "heatIsland": island}
    return {
        "period": report["period"],
        "bias": report["bias"],
        "cities": {city_id: {name: platform(p) for name, p in res["modis"].items()}
                   for city_id, res in report["cities"].items()},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--city", choices=list(CITIES))
    target.add_argument("--all", action="store_true")
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    parser.add_argument("--web", action="store_true", help=f"also write the summary the site reads to {WEB_PATH}")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    results = {city_id: validate_city(get_city(city_id)) for city_id in (CITIES if args.all else [args.city])}
    report = {
        "period": PERIOD.label,
        "modis": {"collection": modis.COLLECTION, "quality": "QC good, or other-quality with good data flag and LST error <= 2 K",
                  "minComposites": modis.MIN_COMPOSITES, "minCellsPerPixel": MIN_CELLS_PER_PIXEL},
        "heatIsland": "median inside the city outline minus median in a ring of the given width around it",
        "bias": "ours (Landsat) minus MODIS, °C",
        "cities": results,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    _print_table(results)
    log.info("written %s", args.out)
    if args.web:
        WEB_PATH.write_text(json.dumps(web_summary(report), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        log.info("written %s", WEB_PATH)


if __name__ == "__main__":
    main()
