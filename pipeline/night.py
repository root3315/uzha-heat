"""Export the summer night surface temperature from MODIS Aqua (about 01:30, 1 km) for the site's night layer.

Uses the same summer composites as pipeline/validate.py (and its cache under pipeline/cache/modis_*), so no download
happens when the validation has been run before. Writes web/public/data/night-<city>.json.

Usage (from the project root):
    python -m pipeline.night --all
    python -m pipeline.night --city tashkent
"""
import argparse
import json
import logging
from pathlib import Path

from .uzha.cities import CITIES, City, get_city
from .uzha.night import PLATFORM, night_document
from .validate import DATA_DIR, city_document, city_outline, fetch_bbox_of, modis_products, period_of

log = logging.getLogger("uzha")


def night_path(city_id: str, directory: Path = DATA_DIR) -> Path:
    return directory / f"night-{city_id}.json"


def export_city(city: City, directory: Path = DATA_DIR) -> Path:
    period = period_of(city_document(city))
    outline = city_outline(city)
    product = modis_products(city, outline, period)[PLATFORM]
    path = night_path(city.id, directory)
    document = night_document(product, period.label, fetch_bbox_of(outline))
    path.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    log.info("written %s (%d x %d pixels)", path, document["grid"]["nx"], document["grid"]["ny"])
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--city", choices=list(CITIES))
    target.add_argument("--all", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    for city_id in CITIES if args.all else [args.city]:
        export_city(get_city(city_id))


if __name__ == "__main__":
    main()
