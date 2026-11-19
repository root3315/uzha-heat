"""How sure "Where to plant first" is: each place's cooling under models refit on block-bootstrap resamples.

The site picks its five places with one model. Refitting it on resamples of whole 2 km blocks of cells (neighbours go
in and out together) and reading the same planting at the same places shows how much each number rests on that one
fit. Reads the published files only; writes web/public/data/plan-uncertainty.json, which the site shows next to each
place.

Usage (from the project root):
    python -m pipeline.plan_check --all
    python -m pipeline.plan_check --city tashkent --replicates 10
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from .cv_check import load
from .uzha import boundary
from .uzha.cities import CITIES
from .uzha.export import write_json
from .uzha.model import BLOCK_SIZE_M, fit_booster
from .uzha.plan import bootstrap_cooling, plan

PIPELINE_DIR = Path(__file__).resolve().parent
DATA_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"
OUT_NAME = "plan-uncertainty.json"
REPLICATES = 50
INTERVAL = (5, 95)


def check(city_id: str, replicates: int = REPLICATES, data_dir: Path = DATA_DIR, inside: np.ndarray = None) -> dict:
    matrix, lst, x, y, keys = load(city_id, data_dir)
    features = pd.DataFrame(matrix, columns=keys)
    cells = json.loads((data_dir / f"{city_id}.json").read_text(encoding="utf-8"))["cells"]
    lon, lat = np.asarray(cells["lon"], float), np.asarray(cells["lat"], float)
    pop = np.asarray(cells.get("pop") or np.zeros(len(lon)), float)
    if inside is None:
        inside = boundary.inside(boundary.load(city_id), lon, lat)
    places = plan(fit_booster(features, lst), features, pop, lon, lat, inside)
    if not places:
        return {"replicates": replicates, "blockM": BLOCK_SIZE_M, "places": []}
    spread = bootstrap_cooling(features, lst, x, y, [p["cell"] for p in places], replicates, BLOCK_SIZE_M)
    low, mid, high = np.percentile(spread, [INTERVAL[0], 50, INTERVAL[1]], axis=0)
    return {
        "replicates": replicates,
        "blockM": BLOCK_SIZE_M,
        "interval": list(INTERVAL),
        "places": [
            {"cell": p["cell"], "cooling": round(p["cooling"], 3), "low": round(float(lo), 2),
             "median": round(float(m), 2), "high": round(float(hi), 2)}
            for p, lo, m, hi in zip(places, low, mid, high)
        ],
    }


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--city", choices=list(CITIES))
    target.add_argument("--all", action="store_true")
    parser.add_argument("--replicates", type=int, default=REPLICATES)
    args = parser.parse_args()

    path = DATA_DIR / OUT_NAME
    result = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    for city_id in (list(CITIES) if args.all else [args.city]):
        result[city_id] = check(city_id, args.replicates)
        print(city_id)
        for i, place in enumerate(result[city_id]["places"], 1):
            print(f"  {i}. cell {place['cell']:>6}  −{place['cooling']:.2f} °C   "
                  f"{INTERVAL[0]}–{INTERVAL[1]} %: −{place['low']:.1f} … −{place['high']:.1f}   median −{place['median']:.1f}")
    write_json(path, result)
    print(f"written: {path}")


if __name__ == "__main__":
    main()
