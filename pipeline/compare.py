"""Compare our 200 m surface temperature with data handed to us: points (CSV) or a raster (GeoTIFF).

Reads our cells from web/public/data/<city>.json, so it needs no downloads and runs in seconds. Prints the
agreement and writes a JSON report to pipeline/cache/compare-<city>-<file>.json.

Usage (from the project root):
    python -m pipeline.compare --city tashkent --points stations.csv              # lon/lat columns found by name
    python -m pipeline.compare --city tashkent --points stations.csv --value t_max
    python -m pipeline.compare --city tashkent --raster their_lst.tif             # any CRS; Kelvin detected
    python -m pipeline.compare --city tashkent --raster scaled.tif --scale 0.00341802 --offset 149
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

from pyproj.exceptions import CRSError
from rasterio.errors import RasterioError

from .uzha.cities import CITIES
from .uzha.external import cells_for_points, compare, compare_by_pixel, raster_to_cells, read_points_csv, to_celsius

PIPELINE_DIR = Path(__file__).resolve().parent
DATA_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"
OUT_DIR = PIPELINE_DIR / "cache"


def _rounded(value):
    """Three decimals, and None for anything missing or not finite, so the report stays valid JSON."""
    if value is None or not math.isfinite(value):
        return None
    return round(value, 3)


def load_cells(city_id: str, data_dir: Path = DATA_DIR) -> tuple:
    document = json.loads((data_dir / f"{city_id}.json").read_text(encoding="utf-8"))
    cells = document["cells"]
    return (np.asarray(cells["lon"], float), np.asarray(cells["lat"], float), np.asarray(cells["lst"], float),
            tuple(document["grid"]["halfSizeDeg"]))


def run(city_id: str, points: Path | None, raster: Path | None, value: str | None, scale: float, offset: float,
        data_dir: Path = DATA_DIR) -> dict:
    lon, lat, lst, half = load_cells(city_id, data_dir)
    pixel = None
    if points is not None:
        found = read_points_csv(points, value)
        cell = cells_for_points(lon, lat, half, found.lon, found.lat)
        theirs, kelvin = to_celsius(found.value * scale + offset)
        ours = np.where(cell >= 0, lst[np.clip(cell, 0, None)], np.nan)
        report = {"source": str(points), "kind": "points", "column": found.value_column, "points": len(cell),
                  "onTheMap": int((cell >= 0).sum()), "kelvin": kelvin,
                  "rows": [{"name": n, "theirs": _rounded(float(t)), "ours": _rounded(float(o))}
                           for n, t, o in zip(found.names, theirs, ours)]}
    else:
        values, pixel = raster_to_cells(raster, lon, lat, half, with_pixels=True)
        theirs, kelvin = to_celsius(values * scale + offset)
        ours = lst
        # A raster coarser than our cells is compared at its own pixels, our cells averaged into them.
        report = {"source": str(raster), "kind": "raster", "cells": len(lst),
                  "covered": int(np.isfinite(theirs).sum()), "kelvin": kelvin,
                  "comparedAt": "our cells" if pixel is None else "their pixels"}
    metrics = compare_by_pixel(ours, theirs, pixel) if pixel is not None else compare(ours, theirs)
    report.update({"city": city_id, **{key: _rounded(v) if isinstance(v, float) else v for key, v in metrics.items()}})
    if report["r"] is None and metrics["n"] >= 3:
        report["note"] = "one side is constant over the matched cells, so r and Spearman are undefined"
    return report


def _print(report: dict) -> None:
    covered = f"{report['onTheMap']} of {report['points']} points on our grid" if report["kind"] == "points" \
        else f"{report['covered']} of {report['cells']} cells covered, compared at {report['comparedAt']}"
    print(f"{report['city']}: {report['source']} ({covered}{', Kelvin → °C' if report['kelvin'] else ''})")
    if report["r"] is None:
        print(f"  too few matched pairs: {report['n']}")
        return
    print(f"  n = {report['n']}   Pearson r = {report['r']:.2f}   Spearman ρ = {report['spearman']:.2f}")
    print(f"  ours − theirs: mean {report['bias']:+.2f} °C, RMSE {report['rmse']:.2f} °C")
    if report["hottestTenthOverlap"] is not None:
        print(f"  hottest 10 %: {report['hottestTenthOverlap']:.0%} of ours are also among theirs")
    for row in report.get("rows", [])[:30]:
        ours = "—" if row["ours"] is None else f"{row['ours']:.1f}"
        print(f"    {row['name'][:28]:<28} theirs {row['theirs']:>6.1f}   ours {ours:>6}")


def main() -> None:
    # The summary prints ρ, ° and −; a Windows console in its default code page cannot, so never let it crash on them.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--city", choices=list(CITIES), required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--points", type=Path, help="CSV with longitude, latitude and a value column")
    source.add_argument("--raster", type=Path, help="GeoTIFF, band 1")
    parser.add_argument("--value", help="the CSV column to compare, when there is more than one numeric column")
    parser.add_argument("--scale", type=float, default=1.0, help="multiply their values first (scaled rasters)")
    parser.add_argument("--offset", type=float, default=0.0, help="then add this")
    parser.add_argument("--data", type=Path, default=DATA_DIR, help="where <city>.json is")
    args = parser.parse_args()

    try:
        report = run(args.city, args.points, args.raster, args.value, args.scale, args.offset, args.data)
    except (ValueError, OSError, RasterioError, CRSError) as error:
        raise SystemExit(f"compare: {error}") from None
    _print(report)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"compare-{args.city}-{(args.points or args.raster).stem}.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1, allow_nan=False), encoding="utf-8")
    print(f"  report: {out}")


if __name__ == "__main__":
    main()
