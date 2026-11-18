"""Buildings for the 3D view: footprints with heights, one FlatGeobuf per city.

Usage (from the project root):
    python -m pipeline.buildings              # all cities, one height model trained on them together
    python -m pipeline.buildings --city samarkand

Writes web/public/data/buildings/<city>.fgb (properties h, conf, src) and model.json with the held-out errors.
The .fgb files are tens of megabytes: they are not committed, the deploy copies them.
"""
import hashlib
import argparse
import json
import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import shapely
from pyproj import Transformer

from .uzha import boundary, footprints, heights
from .uzha.cache import Cache
from .uzha.cities import CITIES, City, get_city
from .uzha.grid import WGS84, utm_crs_for
from .uzha.sources import ghsl, msbuildings, osmpbf

PIPELINE_DIR = Path(__file__).resolve().parent
OUT_DIR = PIPELINE_DIR.parent / "web" / "public" / "data" / "buildings"
CACHE_ROOT = PIPELINE_DIR / "cache"

log = logging.getLogger("uzha")


@dataclass
class CityBuildings:
    city: City
    crs: object
    metric: np.ndarray  # polygons in the city's UTM zone
    known: np.ndarray  # tagged height, m, or NaN
    from_ms: np.ndarray  # bool: the footprint is Microsoft's
    base: pd.DataFrame  # features that do not depend on known heights
    near150: np.ndarray  # neighbours within 150 m, indices into this city


def collect(city: City) -> CityBuildings:
    """OSM footprints of the city and its ring, plus the MS footprints OSM lacks, with their features."""
    bbox, area = boundary.city_extent(city)
    # Keyed by the extent too: a wider outline or ring must not reuse footprints cached for the old one.
    extent_key = hashlib.sha1(repr(tuple(round(v, 5) for v in bbox)).encode()).hexdigest()[:8]
    cache = Cache(CACHE_ROOT / f"buildings_{city.id}_{extent_key}")
    crs = utm_crs_for(*city.center)

    osm_wkb, kinds, tagged = cache.get_or_compute("osm_footprints", lambda: _osm(bbox))
    osm_parts, index = footprints.polygons(shapely.from_wkb(osm_wkb))
    osm_keep = footprints.inside(osm_parts, area)
    osm_metric = footprints.to_crs(osm_parts[osm_keep], WGS84, crs)
    kinds, tagged = kinds[index][osm_keep], tagged[index][osm_keep]

    ms_wkb = cache.get_or_compute("ms_footprints", lambda: _ms(bbox))
    if ms_wkb is None:
        log.warning("%s: Microsoft footprints unavailable, OSM only", city.id)
        ms_wkb = np.empty(0, dtype=object)
    ms_parts, _ = footprints.polygons(shapely.from_wkb(ms_wkb))
    ms_parts = ms_parts[footprints.inside(ms_parts, area)]
    ms_metric = footprints.to_crs(ms_parts, WGS84, crs)
    ms_metric = ms_metric[footprints.without_overlap(ms_metric, osm_metric)]

    metric = np.concatenate([osm_metric, ms_metric])
    big = shapely.area(metric) >= footprints.MIN_AREA_M2
    metric = metric[big]
    kinds = np.concatenate([kinds, np.full(len(ms_metric), "yes", dtype=object)])[big]
    known = np.concatenate([tagged, np.full(len(ms_metric), np.nan)])[big]
    from_ms = np.concatenate([np.zeros(len(osm_metric), bool), np.ones(len(ms_metric), bool)])[big]
    log.info("%s: %d OSM footprints (%d with a height), %d added from Microsoft", city.id, (~from_ms).sum(),
             np.isfinite(known).sum(), from_ms.sum())

    base = _features(city, crs, metric, kinds)
    near150 = heights.neighbours(base["x"].to_numpy(), base["y"].to_numpy(), heights.NEIGHBOUR_RADIUS_M)
    return CityBuildings(city, crs, metric, known, from_ms, base, near150)


def _osm(bbox: tuple) -> tuple:
    polygons, kinds, tagged = osmpbf.footprints(osmpbf.download(CACHE_ROOT / "osm"), bbox)
    return shapely.to_wkb(polygons), kinds, tagged


def _ms(bbox: tuple):
    found = msbuildings.footprints(bbox, CACHE_ROOT / "ms-buildings")
    return None if found is None else shapely.to_wkb(found)


def _features(city: City, crs, metric: np.ndarray, kinds: np.ndarray) -> pd.DataFrame:
    centroids = footprints.to_crs(shapely.centroid(metric), crs, WGS84)
    ghsl_h = ghsl.height_at(shapely.get_x(centroids), shapely.get_y(centroids), CACHE_ROOT / "ghsl")
    center_xy = Transformer.from_crs(WGS84, crs, always_xy=True).transform(*city.center)
    base = heights.shape_features(metric, kinds, center_xy, ghsl_h)
    near100 = heights.neighbours(base["x"].to_numpy(), base["y"].to_numpy(), heights.DENSITY_RADIUS_M)
    return pd.concat([base, heights.density_features(near100, base["area"].to_numpy())], axis=1)


def stack(parts: list) -> tuple:
    """All cities' features in one table, the city as a code, neighbour indices shifted to the stacked rows."""
    frames, near, offset = [], [], 0
    for code, part in enumerate(parts):
        frames.append(part.base.assign(city=code))
        near.append(heights.index_lists([nb + offset for nb in part.near150]))
        offset += len(part.base)
    return pd.concat(frames, ignore_index=True), np.concatenate(near), np.concatenate([p.known for p in parts])


def export(part: CityBuildings, result: heights.Heights, rows: slice, out_dir: Path) -> dict:
    lonlat = footprints.to_crs(footprints.simplify(part.metric), part.crs, WGS84)
    path = out_dir / f"{part.city.id}.fgb"
    footprints.write_fgb(path, lonlat, result.height[rows], result.confidence[rows], result.tagged[rows])
    size_mb = path.stat().st_size / 1e6
    log.info("%s: %d buildings -> %s (%.1f MB)", part.city.id, len(lonlat), path, size_mb)
    return {"buildings": len(lonlat), "tagged": int(result.tagged[rows].sum()), "fromMicrosoft": int(part.from_ms.sum()),
            "sizeMb": round(size_mb, 1)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--city", action="append", choices=list(CITIES), help="city id; repeat for several (default: all)")
    parser.add_argument("--out", type=Path, default=OUT_DIR)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    parts = [collect(get_city(city_id)) for city_id in (args.city or list(CITIES))]
    base, near150, known = stack(parts)
    result = heights.estimate(base, near150, known, [p.city.id for p in parts])
    summary, start = {}, 0
    for part in parts:
        rows = slice(start, start + len(part.base))
        summary[part.city.id] = {**export(part, result, rows, args.out), **result.metrics.get(part.city.id, {})}
        start = rows.stop
    (args.out / "model.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("summary: %s", json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
