"""Where to plant first", as the web app computes it (web/src/domain/plantingPlan.ts and whatIf.ts), and how sure it is.

The site ranks the inhabited cells inside the outline by degrees of cooling × people after one planting (a fifth of the
cell under crowns, NDVI +0.1), at least 1 km apart. The same rules are written here once more so the pipeline can ask
how much a place's cooling depends on the one model that was fit: it refits the model on block-bootstrap resamples of
the cells and reads the same planting at the same places. A web test checks this port gives the site's places.
"""
import numpy as np
import pandas as pd
import xgboost as xgb

from .model import PARAMS, spatial_blocks

PLANTING = {"tree": 20.0, "ndvi": 0.1}
MIN_COOLING = 0.1
BUILT_CUT_POINTS = 25.0
RANGE_QUANTILES = (0.05, 0.95)
PLACES = 5
MIN_GAP_M = 1000.0
EARTH_M_PER_DEG = 111_320.0


def factor_ranges(features: pd.DataFrame) -> dict:
    """The 5th–95th percentile of each factor (linear between neighbours), the sliders' ends."""
    ranges = {}
    for key in features.columns:
        column = features[key].to_numpy(dtype=float)
        column = column[np.isfinite(column)]
        if len(column):
            ranges[key] = tuple(float(q) for q in np.quantile(column, RANGE_QUANTILES))
    return ranges


def _filled(values: np.ndarray) -> np.ndarray:
    return np.where(np.isfinite(values), values, 0.0)


def _cover_sum(frame: pd.DataFrame) -> np.ndarray:
    return sum(_filled(frame[key].to_numpy(dtype=float)) for key in ("tree", "built", "bare") if key in frame)


def planted(features: pd.DataFrame, ranges: dict) -> pd.DataFrame:
    """Every cell after the planting: clamped to the city's range (widened to take in the cell's own value), then the
    land-cover shares kept possible, crowns taking bare ground first, then built-up (`balanceCover`)."""
    cells = features
    changed = features.copy()
    for key, add in PLANTING.items():
        if key not in features:
            continue
        here = features[key].to_numpy(dtype=float)
        target = here + add
        if key in ranges:
            lo, hi = ranges[key]
            known = np.isfinite(here)
            target = np.where(known, np.clip(target, np.minimum(lo, here), np.maximum(hi, here)), np.clip(target, lo, hi))
        changed[key] = target

    excess = _cover_sum(changed) - np.maximum(100.0, _cover_sum(cells))

    def take(key: str, floor: np.ndarray) -> None:
        nonlocal excess
        if key not in changed:
            return
        value = changed[key].to_numpy(dtype=float)
        can = (excess > 0) & np.isfinite(value)
        taken = np.where(can, np.minimum(excess, np.maximum(0.0, value - np.maximum(0.0, floor))), 0.0)
        changed[key] = value - taken
        excess = excess - taken

    take("bare", np.zeros(len(changed)))
    if "built" in cells:
        built = cells["built"].to_numpy(dtype=float)
        take("built", np.where(np.isfinite(built), built - BUILT_CUT_POINTS, 0.0))
    if "tree" in changed:
        tree = changed["tree"].to_numpy(dtype=float)
        own = _filled(cells["tree"].to_numpy(dtype=float))
        fix = (excess > 0) & np.isfinite(tree)
        changed["tree"] = np.where(fix, np.maximum(own, tree - excess), tree)
    return changed


def cooling(booster: xgb.Booster, features: pd.DataFrame, after: pd.DataFrame) -> np.ndarray:
    """Degrees the model cools each row by, positive; float32 like the booster and the browser."""
    before = booster.predict(xgb.DMatrix(features)).astype(np.float32)
    later = booster.predict(xgb.DMatrix(after)).astype(np.float32)
    return (before - later).astype(float)


def _distance_m(a: tuple, b: tuple) -> float:
    k = np.cos(np.radians(a[1]))
    return float(np.hypot((b[0] - a[0]) * EARTH_M_PER_DEG * k, (b[1] - a[1]) * EARTH_M_PER_DEG))


def plan(booster: xgb.Booster, features: pd.DataFrame, pop: np.ndarray, lon: np.ndarray, lat: np.ndarray,
         inside: np.ndarray, count: int = PLACES, min_gap_m: float = MIN_GAP_M) -> list:
    """The site's places: [{cell, cooling, people}], best first."""
    candidates = np.flatnonzero(np.asarray(inside, bool) & (np.asarray(pop, float) > 0))
    rows = features.iloc[candidates].reset_index(drop=True)
    cooled = cooling(booster, rows, planted(rows, factor_ranges(features)))
    keep = cooled >= MIN_COOLING
    cells, cooled = candidates[keep], cooled[keep]
    gain = cooled * np.asarray(pop, float)[cells]
    order = np.argsort(-gain, kind="stable")
    picked = []
    for i in order:
        if len(picked) >= count:
            break
        point = (float(lon[cells[i]]), float(lat[cells[i]]))
        if any(_distance_m(p["point"], point) < min_gap_m for p in picked):
            continue
        picked.append({"cell": int(cells[i]), "cooling": float(cooled[i]), "people": float(pop[cells[i]]), "point": point})
    return [{key: place[key] for key in ("cell", "cooling", "people")} for place in picked]


def bootstrap_cooling(features: pd.DataFrame, target: np.ndarray, x: np.ndarray, y: np.ndarray, cells: list,
                      replicates: int, block_m: float, seed: int = 0) -> np.ndarray:
    """(replicates × places) cooling at the given cells by models refit on resamples of whole spatial blocks, so
    neighbouring cells go in and out together."""
    blocks = spatial_blocks(x, y, block_m)
    members = [np.flatnonzero(blocks == b) for b in np.unique(blocks)]
    rng = np.random.default_rng(seed)
    rows = features.iloc[cells].reset_index(drop=True)
    after = planted(rows, factor_ranges(features))
    out = np.empty((replicates, len(cells)))
    for r in range(replicates):
        sample = np.concatenate([members[i] for i in rng.integers(0, len(members), len(members))])
        booster = xgb.XGBRegressor(**PARAMS).fit(features.iloc[sample], target[sample]).get_booster()
        out[r] = cooling(booster, rows, after)
    return out
