"""How far the model's skill can be trusted: block size, a buffer between training and test cells, and baselines.

Reads the published cells (factors and LST) from web/public/data/<city>.json, so it needs no downloads. Prints a table
and writes pipeline/cache/cv-check.json.

Usage (from the project root):
    python -m pipeline.cv_check --all
    python -m pipeline.cv_check --city tashkent
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import xgboost as xgb
from pyproj import Transformer
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import KFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .uzha.cities import CITIES
from .uzha.cv import buffered_folds, out_of_fold, spatial_folds
from .uzha.grid import WGS84, utm_crs_for
from .uzha.model import BLOCK_SIZE_M, CV_FOLDS, PARAMS

PIPELINE_DIR = Path(__file__).resolve().parent
DATA_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"
OUT_PATH = PIPELINE_DIR / "cache" / "cv-check.json"
BUFFER_M = 400.0  # two cells: no training cell touches a held-out one
BLOCK_SIZES_M = (1000.0, 2000.0, 4000.0)


def _xgboost():
    return xgb.XGBRegressor(**PARAMS)


def _linear():
    return make_pipeline(StandardScaler(), LinearRegression())


def load(city_id: str, data_dir: Path = DATA_DIR) -> tuple:
    """(factor matrix, LST, x, y in metres, factor names) from a published city file."""
    document = json.loads((data_dir / f"{city_id}.json").read_text(encoding="utf-8"))
    cells = document["cells"]
    keys = [feature["key"] for feature in document["features"]]
    features = np.column_stack([np.asarray(cells["values"][key], float) for key in keys])
    lon, lat = np.asarray(cells["lon"], float), np.asarray(cells["lat"], float)
    to_utm = Transformer.from_crs(WGS84, utm_crs_for(float(lon.mean()), float(lat.mean())), always_xy=True)
    x, y = to_utm.transform(lon, lat)
    return features, np.asarray(cells["lst"], float), np.asarray(x), np.asarray(y), keys


def check(city_id: str, data_dir: Path = DATA_DIR) -> list:
    features, lst, x, y, keys = load(city_id, data_dir)
    ndvi = features[:, [keys.index("ndvi")]]
    rows = []

    def add(name, make, data, folds):
        r2, mae = out_of_fold(make, data, lst, folds)
        rows.append({"check": name, "r2": round(r2, 3), "mae": round(mae, 3)})

    for block in BLOCK_SIZES_M:
        add(f"XGBoost, {block / 1000:g} km blocks", _xgboost, features, spatial_folds(x, y, block, CV_FOLDS))
    add(f"XGBoost, {BLOCK_SIZE_M / 1000:g} km blocks, {BUFFER_M:g} m buffer", _xgboost, features,
        buffered_folds(x, y, BLOCK_SIZE_M, CV_FOLDS, BUFFER_M))
    add("XGBoost, random cells (not spatial)", _xgboost, features,
        KFold(n_splits=CV_FOLDS, shuffle=True, random_state=0).split(features))
    add(f"Linear, all factors, {BLOCK_SIZE_M / 1000:g} km blocks", _linear, features, spatial_folds(x, y, BLOCK_SIZE_M, CV_FOLDS))
    add(f"Linear, NDVI only, {BLOCK_SIZE_M / 1000:g} km blocks", _linear, ndvi, spatial_folds(x, y, BLOCK_SIZE_M, CV_FOLDS))
    return rows


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--city", choices=list(CITIES))
    target.add_argument("--all", action="store_true")
    args = parser.parse_args()

    result = {}
    for city_id in (list(CITIES) if args.all else [args.city]):
        result[city_id] = check(city_id)
        print(city_id)
        for row in result[city_id]:
            print(f"  {row['check']:<44} R² {row['r2']:.2f}   MAE {row['mae']:.2f} °C")
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"written: {OUT_PATH}")


if __name__ == "__main__":
    main()
