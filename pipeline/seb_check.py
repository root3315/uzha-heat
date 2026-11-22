"""The physics model of a city end to end: skill, fitted parameters, fluxes, the heat-island budget and the scenarios.

Per city: builds the energy balance inputs (uzha/seb/inputs.py, cached downloads); scores physics alone and physics
plus a learned correction (the 11 published factors) out of fold on 2 km blocks; fits the final parameters on all cells
and solves; splits the city-minus-ring contrast by factor group with Shapley values (Eq. 59–63) and keeps the remainder
as Other; runs each scenario of app-spec 11.2 on the cells inside the city outline, with a 5–95 % range from parameters
refitted on block-bootstrap resamples. Writes web/public/data/physics.json, which the method page shows when present.

Shapley over the 8 groups is exact (all 2^8 coalitions) but is computed on a stratified sample of cells, not all of
them: SHAPLEY_SAMPLE cells inside and as many in the ring, drawn evenly across LST quintiles of each side, each weighted
by how many cells it stands for. Every term of the budget is a weighted mean over that same sample, so the parts still
add up exactly.

Usage (from the project root):
    python -m pipeline.seb_check --all
    python -m pipeline.seb_check --city tashkent

Slow steps are cached in pipeline/cache/seb/<id>_check/, keyed by a hash of the inputs, so a rerun on unchanged data
only rewrites the JSON.
"""
import argparse
import hashlib
import json
import logging
import sys
import time
from pathlib import Path

import numpy as np

from .cv_check import load
from .uzha.cache import Cache
from .uzha.cities import CITIES
from .uzha.export import write_json
from .uzha.model import BLOCK_SIZE_M, spatial_blocks
from .uzha.seb import attribution, calibrate, inputs as seb_inputs
from .uzha.seb.scenarios import SCENARIOS, run_scenario
from .uzha.seb.solve import solve
from .uzha.seb.types import Params

log = logging.getLogger(__name__)

PIPELINE_DIR = Path(__file__).resolve().parent
DATA_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"
CACHE_ROOT = PIPELINE_DIR / "cache"
OUT_NAME = "physics.json"

SHAPLEY_SAMPLE = 1500  # cells per side (inside, ring): 256 coalitions × 3000 cells take minutes, not half an hour
STRATA = 5  # LST quintiles per side
REPLICATES = 10  # block-bootstrap refits of the parameters for the scenario ranges
INTERVAL = (5, 95)
FLUXES = ("rn", "h", "le", "dqs", "qf")
EFFICIENCY_TOLERANCE_K = 1e-6

# What each scenario changes, for the whole city at once. Shares below 100 % where treating everything is not a plan.
SCENARIO_SETTINGS = {
    "cool_roofs": {"albedo": 0.55},
    "cool_pavements": {"albedo": 0.30, "tiles": ("road",)},
    "trees": {"share": 0.10, "source": ("paved", "bare")},
    "green_roofs": {"share": 0.5, "irrigated": True},
    "permeable": {"share": 0.5, "to": "grass"},
    "waste_heat": {"reduction": 0.3},
}


def input_key(inputs, forcing, observed) -> str:
    """Short hash of everything the slow steps depend on, so a cache entry never outlives its inputs."""
    digest = hashlib.sha1()
    for name in inputs.__dataclass_fields__:
        digest.update(np.ascontiguousarray(getattr(inputs, name), dtype=float).tobytes())
    for name in forcing.__dataclass_fields__:
        digest.update(np.ascontiguousarray(getattr(forcing, name), dtype=float).tobytes())
    digest.update(np.ascontiguousarray(observed, dtype=float).tobytes())
    return digest.hexdigest()[:10]


def stratified_sample(inside: np.ndarray, observed: np.ndarray, per_side: int, strata: int = STRATA,
                      seed: int = 0) -> tuple:
    """(cells, weight): up to `per_side` cells inside and in the ring, spread evenly over LST quantiles of each side.

    A cell's weight is the number of cells of its stratum over the number drawn from it, so weighted means over the
    sample estimate the means over all cells (cells are all the same 200 m square).
    """
    rng = np.random.default_rng(seed)
    cells, weight = [], []
    for side in (np.asarray(inside, bool), ~np.asarray(inside, bool)):
        members = np.flatnonzero(side)
        if len(members) <= per_side:
            cells.append(members)
            weight.append(np.ones(len(members)))
            continue
        edges = np.quantile(observed[members], np.linspace(0, 1, strata + 1)[1:-1])
        stratum = np.searchsorted(edges, observed[members], side="right")
        for s in range(strata):
            pool = members[stratum == s]
            if len(pool) == 0:
                continue
            take = max(1, round(per_side * len(pool) / len(members)))
            drawn = rng.choice(pool, min(take, len(pool)), replace=False)
            cells.append(drawn)
            weight.append(np.full(len(drawn), len(pool) / len(drawn)))
    return np.concatenate(cells), np.concatenate(weight)


def skill(predicted: np.ndarray, observed: np.ndarray, where: np.ndarray = None) -> dict:
    s = calibrate.score(predicted, observed, where)
    return {"r2": round(s.r2, 3), "mae": round(s.mae, 3), "bias": round(s.bias, 3)}


def cell_fluxes(fraction: np.ndarray, state) -> dict:
    """Cell mean of each flux, W m⁻²: the tiles' fluxes weighted by their area."""
    return {name: np.sum(fraction * getattr(state, name), axis=1) for name in FLUXES}


def mean_fluxes(fraction: np.ndarray, state, inside: np.ndarray) -> dict:
    """Mean of each cell flux inside the outline and in the ring, over cells whose every tile converged."""
    fluxes = cell_fluxes(fraction, state)
    ok = state.converged.all(axis=1)
    return {side: {name: round(float(values[mask & ok].mean()), 1) for name, values in fluxes.items()}
            for side, mask in (("inside", inside), ("ring", ~inside))}


def shapley_budget(inputs, forcing, params, observed, inside, per_side: int = SHAPLEY_SAMPLE, seed: int = 0) -> dict:
    """City-minus-ring budget by factor group (Eq. 60–63) from exact Shapley values on a stratified sample of cells."""
    reference = attribution.reference_state(inputs, ~inside)
    cells, weight = stratified_sample(inside, observed, per_side, seed=seed)
    part, forced = calibrate.subset(inputs, forcing, cells)
    table = attribution.coalition_temperatures(part, forced, params, reference)
    phi = attribution.shapley_from_table(table, len(attribution.GROUPS))
    # Efficiency (Eq. 59): per cell the contributions add up to T(all observed) − T(all at reference).
    gap = np.abs(phi.sum(axis=1) - (table[-1] - table[0]))
    solved = np.isfinite(gap)  # cells with an unconverged coalition are NaN and left out of the budget
    if not solved.any():
        raise AssertionError("no sampled cell converged in every coalition")
    efficiency = float(gap[solved].max())
    if efficiency > EFFICIENCY_TOLERANCE_K:
        raise AssertionError(f"Shapley efficiency off by {efficiency:.2e} K")
    result = attribution.budget(phi, observed[cells], inside[cells], table[-1], cell_area=weight)
    return {
        "observed": round(result["observed"], 3),
        "groups": [{"id": g, "contribution": round(v, 3)} for g, v in result["groups"].items()],
        "other": round(result["other"], 3),
        "modelGap": round(result["model_gap"], 3),
        "referenceState": round(result["reference_state"], 3),
        "model": round(result["model"], 3),
        "sample": {"inside": result["cells"]["inside"], "ring": result["cells"]["ring"],
                   "cellsInside": int(inside.sum()), "cellsRing": int((~inside).sum())},
        "efficiencyK": efficiency,
    }


def scenario_changes(inputs, forcing, params, settings: dict = SCENARIO_SETTINGS) -> dict:
    """{scenario: {treated, whole, areaShare, assumptions}}: mean change on the treated surfaces and over all cells, K.

    The baseline is solved once for all scenarios. Cells where a tile fails to converge, before or after, are left out.
    """
    base = solve(inputs, forcing, params)
    states = {}

    def solve_once(given, given_forcing, given_params):
        if given is inputs:
            return base
        states["after"] = solve(given, given_forcing, given_params)
        return states["after"]

    out = {}
    for name, options in settings.items():
        result = run_scenario(inputs, forcing, params, SCENARIOS[name](inputs, **options), solve=solve_once)
        ok = base.converged.all(axis=1) & states["after"].converged.all(axis=1)
        share = result["treated_share"]
        treated = ok & (share > 0)
        out[name] = {
            "treated": float(np.sum(share[treated] * result["dt_treated"][treated]) / share[treated].sum())
            if treated.any() else float("nan"),
            "whole": float(result["dt_whole"][ok].mean()),
            "areaShare": float(share[ok].mean()),
            "assumptions": result["assumptions"],
        }
    return out


def bootstrap_params(inputs, forcing, observed, x, y, start: Params, replicates: int, seed: int = 0,
                     cache: Cache = None, key: str = "") -> list:
    """Parameters refitted on resamples of whole 2 km blocks drawn with replacement."""
    blocks = spatial_blocks(x, y, BLOCK_SIZE_M)
    ids = np.unique(blocks)
    members = {b: np.flatnonzero(blocks == b) for b in ids}
    rng = np.random.default_rng(seed)
    draws = [rng.choice(ids, len(ids), replace=True) for _ in range(replicates)]
    fitted = []
    for k, drawn in enumerate(draws):
        cells = np.concatenate([members[b] for b in drawn])
        compute = lambda: calibrate.fit(inputs, forcing, observed, cells, start=start, seed=k)
        fitted.append(cache.get_or_compute(f"bootstrap_{key}_{k}", compute) if cache else compute())
    return fitted


def scenario_ranges(inputs, forcing, observed, inside, x, y, params, replicates: int, cache: Cache = None,
                    key: str = "") -> list:
    """Each scenario with the final parameters, and its 5–95 % range over the bootstrap refits."""
    part, forced = calibrate.subset(inputs, forcing, np.flatnonzero(inside))

    settings_key = hashlib.sha1(repr(sorted(SCENARIO_SETTINGS.items())).encode()).hexdigest()[:6]

    def changes(p, name):
        compute = lambda: scenario_changes(part, forced, p)
        return cache.get_or_compute(f"scenarios_{key}_{settings_key}_{name}", compute) if cache else compute()

    main = changes(params, "final")
    refits = bootstrap_params(inputs, forcing, observed, x, y, params, replicates, cache=cache, key=key)
    spread = [changes(p, f"refit{k}") for k, p in enumerate(refits)]

    def triple(name, field):
        mid = main[name][field]
        if not np.isfinite(mid):
            return None
        values = [s[name][field] for s in spread if np.isfinite(s[name][field])]
        lo, hi = np.percentile(values, INTERVAL) if values else (mid, mid)
        return [round(float(min(lo, mid)), 3), round(mid, 3), round(float(max(hi, mid)), 3)]

    return [{"id": name, "treatedDT": triple(name, "treated"), "wholeDT": triple(name, "whole"),
             "areaShare": round(main[name]["areaShare"], 4), "settings": _settings(part, name),
             "assumptions": main[name]["assumptions"]}
            for name in main]


def _settings(inputs, name: str) -> dict:
    """The scenario's full settings, defaults included, as JSON values (the site words its assumptions from them)."""
    settings = SCENARIOS[name](inputs, **SCENARIO_SETTINGS[name]).settings
    return {key: list(value) if isinstance(value, tuple) else value for key, value in settings.items()}


def analyse(inputs, forcing, observed, inside, factors, x, y, cache: Cache = None, replicates: int = REPLICATES,
            shapley_sample: int = SHAPLEY_SAMPLE, folds: int = calibrate.CV_FOLDS) -> dict:
    """Everything physics.json holds for one city. `observed` in K; `inside` the cells within the outline."""
    inside = np.asarray(inside, bool)
    key = input_key(inputs, forcing, observed)
    cached = (lambda name, compute: cache.get_or_compute(f"{name}_{key}", compute)) if cache else (lambda _, c: c())

    started = time.monotonic()
    hybrid, physics, _ = cached("cv", lambda: calibrate.cross_validate_hybrid(
        inputs, forcing, observed, factors, x, y, folds=folds))
    log.info("cross-validation done in %.0f s", time.monotonic() - started)
    params = cached("params", lambda: calibrate.fit(inputs, forcing, observed, np.arange(len(observed))))
    state = solve(inputs, forcing, params)
    started = time.monotonic()
    budget = cached(f"budget{shapley_sample}", lambda: shapley_budget(inputs, forcing, params, observed, inside,
                                                                       shapley_sample))
    log.info("budget done in %.0f s", time.monotonic() - started)
    started = time.monotonic()
    scenarios = scenario_ranges(inputs, forcing, observed, inside, x, y, params, replicates, cache, key)
    log.info("scenarios done in %.0f s", time.monotonic() - started)
    return {
        "skill": {
            "physics": skill(physics, observed),
            "hybrid": skill(hybrid, observed),
            "inside": {"physics": skill(physics, observed, inside), "hybrid": skill(hybrid, observed, inside)},
        },
        "params": {name: round(value, 3) for name, value in zip(Params.BOUNDS, params.vector())},
        "converged": round(float(state.converged.all(axis=1).mean()), 4),
        "fluxes": mean_fluxes(inputs.fraction, state, inside),
        "budget": budget,
        "scenarios": scenarios,
        "replicates": replicates,
        "interval": list(INTERVAL),
    }


def check(city_id: str, data_dir: Path = DATA_DIR, cache_root: Path = CACHE_ROOT, replicates: int = REPLICATES) -> dict:
    inputs, forcing, observed, inside = seb_inputs.build(city_id, data_dir, cache_root)
    factors, _, x, y, _ = load(city_id, data_dir)
    cache = Cache(Path(cache_root) / "seb" / f"{city_id}_check")
    return analyse(inputs, forcing, observed, inside, factors, x, y, cache, replicates)


def _print(city_id: str, result: dict) -> None:
    print(city_id)
    for name in ("physics", "hybrid"):
        s, i = result["skill"][name], result["skill"]["inside"][name]
        print(f"  {name:<8} R² {s['r2']:.2f}  MAE {s['mae']:.2f}  bias {s['bias']:+.2f}   inside R² {i['r2']:.2f}  "
              f"MAE {i['mae']:.2f}")
    print("  params  " + ", ".join(f"{k} {v}" for k, v in result["params"].items()))
    for side, fluxes in result["fluxes"].items():
        print(f"  {side:<7} " + "  ".join(f"{k} {v:.0f}" for k, v in fluxes.items()) + " W/m²")
    b = result["budget"]
    print(f"  budget  observed {b['observed']:+.2f}  " + "  ".join(f"{g['id']} {g['contribution']:+.2f}" for g in b["groups"])
          + f"  other {b['other']:+.2f}  (model gap {b['modelGap']:+.2f})")
    for s in result["scenarios"]:
        print(f"  {s['id']:<15} treated {s['treatedDT'][1]:+.2f} [{s['treatedDT'][0]:+.2f} … {s['treatedDT'][2]:+.2f}]  "
              f"city {s['wholeDT'][1]:+.3f} [{s['wholeDT'][0]:+.3f} … {s['wholeDT'][2]:+.3f}]  area {s['areaShare']:.1%}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--city", choices=list(CITIES))
    target.add_argument("--all", action="store_true")
    parser.add_argument("--replicates", type=int, default=REPLICATES)
    parser.add_argument("--cache-root", type=Path, default=CACHE_ROOT)
    args = parser.parse_args()

    path = DATA_DIR / OUT_NAME
    result = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    for city_id in (list(CITIES) if args.all else [args.city]):
        try:
            result[city_id] = check(city_id, cache_root=args.cache_root, replicates=args.replicates)
        except Exception as error:  # one city without its inputs must not stop the others
            log.error("%s: physics check failed: %s", city_id, error)
            continue
        _print(city_id, result[city_id])
        write_json(path, result)
    print(f"written: {path}")


if __name__ == "__main__":
    main()
