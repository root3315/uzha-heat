"""Build heat-island data for the web app.

Usage (from the project root):
    python -m pipeline.run --city tashkent
    python -m pipeline.run --all
    python -m pipeline.run --city tashkent --only population   # enrich an existing <id>.json
    python -m pipeline.run --city tashkent --only weather
"""
import argparse
import logging
from pathlib import Path

import shapely

from .uzha import boundary, export, features, model, population, weather
from .uzha.cache import Cache
from .uzha.cities import CITIES, City, get_city
from .uzha.grid import Grid, half_size_deg
from .uzha.sources import osm, wiki

PIPELINE_DIR = Path(__file__).resolve().parent
DEFAULT_OUT = PIPELINE_DIR.parent / "web" / "public" / "data"
CACHE_ROOT = PIPELINE_DIR / "cache"
CELL_SIZE_M = 200.0

log = logging.getLogger("uzha")


def process_city(city: City, out_dir: Path) -> dict:
    bbox, area = boundary.city_extent(city)
    grid = Grid.from_bbox(bbox, CELL_SIZE_M)
    cache = Cache(CACHE_ROOT / f"{city.id}_{grid.key()}")
    log.info("%s: bbox %s, grid %dx%d cells in %s", city.id, tuple(round(v, 4) for v in bbox), grid.rows, grid.cols,
             grid.crs)

    table = features.build(city, grid, cache, area)
    cells = table.cells
    factors = cells[table.factors]
    lst = cells["lst"].to_numpy()
    fitted = model.fit(factors, lst, cells["x"].to_numpy(), cells["y"].to_numpy())
    importance = model.global_importance(factors, lst, fitted.shap)

    photo = cache.get_or_compute("wiki_photo", lambda: wiki.city_photo(city.wiki_title))
    stats = export.lst_stats(lst)
    entry = export.city_entry(city, photo, stats["lstMean"], fitted.r2_cv, bbox)
    document = export.city_document(
        entry=entry,
        period={"label": table.period_label, "lstScenes": table.lst_scenes, "s2Scenes": table.s2_scenes},
        grid={"cellSizeM": int(CELL_SIZE_M), "halfSizeDeg": [round(v, 6) for v in half_size_deg(CELL_SIZE_M, city.center[1])],
              "count": len(cells)},
        features=export.feature_descriptions(table.factors, features.FACTORS),
        model={"type": "XGBoost", "r2Cv": export.r3(fitted.r2_cv), "maeCv": export.r3(fitted.mae_cv),
               "cv": f"spatial block {model.CV_FOLDS}-fold ({model.BLOCK_SIZE_M / 1000:g} km blocks)",
               "baseValue": export.r3(fitted.base_value)},
        stats=stats,
        importance=importance,
        cells=export.cells_block(cells["lon"], cells["lat"], lst,
                                 {key: cells[key] for key in table.factors},
                                 {key: fitted.shap[key] for key in table.factors}),
        districts=_districts(city, grid, cells, fitted.shap, cache),
    )
    population.enrich(document, CACHE_ROOT)
    weather.enrich(document, CACHE_ROOT)  # adds city.weather, so the cities.json entry gets it too
    export.write_json(out_dir / f"{city.id}.json", document)
    export.update_cities_index(out_dir / "cities.json", entry, list(CITIES))
    _log_summary(city, table, fitted, importance, stats, document)
    return document


def _districts(city: City, grid: Grid, cells, shap, cache: Cache) -> list:
    if city.osm_relation_id is None:
        return []
    elements = cache.get_or_compute(
        "osm_districts", lambda: osm.fetch_districts(city.osm_relation_id, city.district_admin_level, grid.bbox_lonlat()))
    if not elements:
        log.warning("%s: district boundaries unavailable, skipping", city.id)
        return []
    lon, lat = cells["lon"].to_numpy(), cells["lat"].to_numpy()
    districts = []
    for name, polygon in osm.district_polygons(elements, city.osm_relation_id):
        inside = shapely.contains_xy(polygon, lon, lat)
        if inside.any():
            districts.append(export.district_entry(
                name, polygon, cells["lst"].to_numpy()[inside],
                {key: shap[key].to_numpy()[inside] for key in shap.columns}))
    return districts


def _log_summary(city, table, fitted, importance, stats, document) -> None:
    log.info("%s: %d cells, Landsat %d scenes (%s), S2 %d scenes", city.id, len(table.cells),
             table.lst_scenes, table.period_label, table.s2_scenes)
    log.info("%s: r2Cv=%.3f maeCv=%.3f °C base=%.2f °C, LST %.1f..%.1f °C", city.id, fitted.r2_cv,
             fitted.mae_cv, fitted.base_value, stats["lstMin"], stats["lstMax"])
    for row in importance[:5]:
        log.info("  %-11s |SHAP|=%.3f °C  r=%+.2f", row["key"], row["meanAbsShap"], row["correlation"])
    if table.dropped:
        log.warning("%s: dropped factors %s", city.id, table.dropped)
    log.info("%s: %d districts", city.id, len(document.get("districts", [])))


def _log_population(document: dict) -> None:
    city_id = document["city"]["id"]
    if "population" in document:
        log.info("%s: %d people in %d cells", city_id, document["population"]["total"], len(document["cells"]["pop"]))
    kinds = [f["type"] for f in document.get("facilities", [])]
    log.info("%s: facilities %s", city_id, {kind: kinds.count(kind) for kind in sorted(set(kinds))})


def _log_weather(document: dict) -> None:
    city = document["city"]
    if "weather" not in city:
        return
    log.info("%s: summer %s", city["id"], city["weather"]["summer"])
    if "overpass" in city["weather"]:
        log.info("%s: at Landsat overpasses %s", city["id"], city["weather"]["overpass"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--city", choices=list(CITIES))
    target.add_argument("--all", action="store_true")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--only", choices=["population", "weather"],
                        help="run one light step over the existing <id>.json instead of the whole pipeline")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    city_ids = list(CITIES) if args.all else [args.city]
    failed = []
    for city_id in city_ids:
        try:
            if args.only == "population":
                _log_population(population.enrich_file(args.out / f"{city_id}.json", CACHE_ROOT))
            elif args.only == "weather":
                _log_weather(weather.enrich_file(args.out / f"{city_id}.json", CACHE_ROOT))
            else:
                process_city(get_city(city_id), args.out)
        except Exception:
            log.exception("%s failed", city_id)
            failed.append(city_id)
    if failed:
        raise SystemExit(f"Failed: {', '.join(failed)}")


if __name__ == "__main__":
    main()
