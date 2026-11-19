"""Golden cases for the browser port of the energy-balance solver (web/src/domain/seb/).

Builds random but plausible single-cell cases (every tile, calm to windy, stable and unstable tiles, parameters across
their bounds), solves them with pipeline.uzha.seb.solve.solve and writes inputs, forcing, parameters and the solution
to web/src/domain/seb/golden.json. A vitest test reproduces every case in TypeScript; pipeline/tests/test_seb_golden.py
fails when the file no longer matches the Python solver, so rerun this script after changing the physics.

Usage (from the project root):
    python -m pipeline.seb_golden
"""
import json
from pathlib import Path

import numpy as np

from .uzha.seb.solve import solve
from .uzha.seb.types import IMPERVIOUS, TILE, TILES, Forcing, Params, SebInputs

GOLDEN_PATH = Path(__file__).resolve().parent.parent / "web" / "src" / "domain" / "seb" / "golden.json"
SEED = 2026
CASES = 40
DIGITS = 6  # inputs are rounded before solving, so the file holds exactly what was solved

N_TILES = len(TILES)
# Plausible (low, high) per tile, in TILES order.
ALBEDO = [(0.12, 0.20), (0.18, 0.26), (0.20, 0.35), (0.10, 0.70), (0.06, 0.30), (0.12, 0.35), (0.05, 0.10)]
EMISSIVITY = [(0.97, 0.99), (0.94, 0.99), (0.92, 0.97), (0.88, 0.95), (0.93, 0.96), (0.90, 0.96), (0.96, 0.99)]
OHM = [(0.11, 0.11, -12.3), (0.32, 0.54, -27.4), (0.36, 0.27, -42.4), (0.12, 0.24, -4.5),
       (0.50, 0.28, -31.4), (0.70, 0.30, -40.0), (0.50, 0.21, -39.1)]
# Wind speeds at z_ref the cases cycle through, m s⁻¹: calm (below the numerical floor), light, moderate, strong.
WINDS = (0.0, 0.05, 0.3, 0.8, 1.5, 3.0, 5.0, 9.0)


def _round(value):
    return np.round(np.asarray(value, dtype=float), DIGITS)


def _fraction(rng, case):
    """Tile shares: every fifth case is a single tile, the rest a random mix with some tiles absent."""
    if case % 5 == 0:
        fraction = np.zeros(N_TILES)
        fraction[(case // 5) % N_TILES] = 1.0
        return fraction
    fraction = rng.uniform(0.0, 1.0, N_TILES) ** 2
    fraction[rng.random(N_TILES) < 0.3] = 0.0
    if case % 7 == 3:
        fraction[[TILE[name] for name in IMPERVIOUS]] = 0.0  # no impervious surface: QF spread over every tile
    if fraction.sum() == 0.0:
        fraction[TILE["grass"]] = 1.0
    fraction = _round(fraction / fraction.sum())
    fraction[np.argmax(fraction)] += 1.0 - fraction.sum()
    return fraction


def _inputs(rng, case):
    low, high = np.array(ALBEDO).T
    albedo = rng.uniform(low, high)
    low, high = np.array(EMISSIVITY).T
    emissivity = rng.uniform(low, high)
    shade = rng.uniform(0.0, 0.7, N_TILES)
    shade[[TILE["roof"], TILE["water"]]] = 0.0
    ohm = np.array(OHM) * rng.uniform(0.7, 1.3, (N_TILES, 1))
    fraction = _fraction(rng, case)
    return dict(
        fraction=fraction, albedo=_round(albedo), emissivity=_round(emissivity), shade=_round(shade),
        sky_view=_round(rng.uniform(0.3, 1.0)), z0m=_round(rng.uniform(0.0, 2.5)), zd=_round(rng.uniform(0.0, 20.0)),
        soil_moisture=_round(rng.uniform(0.03, 0.45)), irrigated=bool(rng.random() < 0.3), ohm=_round(ohm),
        qf=_round(rng.uniform(0.0, 150.0) * (rng.random() < 0.8)), rural=bool(rng.random() < 0.25))


def _wind(rng, case):
    """Cycles through WINDS; the calm cases are exactly 0, the others jittered."""
    wind = WINDS[case % len(WINDS)]
    return float(_round(wind + rng.uniform(0.0, 0.2))) if wind > 0 else 0.0


def _forcing(rng, case):
    """Late-morning overpass weather, with every fourth case in weak evening sun so that tiles turn stable."""
    weak_sun = case % 4 == 1
    return dict(
        k_down=_round(rng.uniform(20.0, 150.0) if weak_sun else rng.uniform(500.0, 950.0)),
        diffuse_fraction=_round(rng.uniform(0.1, 0.5)), l_down=_round(rng.uniform(300.0, 400.0)),
        t_air=_round(rng.uniform(285.0, 315.0)), e_air=_round(rng.uniform(0.4, 2.5)),
        pressure=_round(rng.uniform(85.0, 101.3)), wind=_wind(rng, case),
        z_ref=_round(rng.uniform(10.0, 60.0)), zenith=_round(rng.uniform(0.3, 1.2)),
        dk_dt=_round(rng.uniform(-100.0, 120.0)))


def _params(rng, case):
    if case % 3 == 0:
        return {name: float(value) for name, value in zip(Params.BOUNDS, Params().vector())}
    return {name: float(_round(rng.uniform(low, high))) for name, (low, high) in Params.BOUNDS.items()}


def _solve(inputs, forcing, params):
    """Solve one cell with the Python solver; returns the TileState of a one-cell batch."""
    batch = SebInputs(**{name: np.asarray(value)[None, ...] for name, value in inputs.items()})
    return solve(batch, Forcing(**forcing), Params(**params))


def _camel(name):
    head, *rest = name.split("_")
    return head + "".join(part.capitalize() for part in rest)


def _plain(value):
    value = np.asarray(value)
    return value.tolist() if value.ndim else value.item()


def build_cases(seed=SEED, count=CASES):
    """The golden cases as plain JSON-ready dicts with the TypeScript field names."""
    rng = np.random.default_rng(seed)
    cases = []
    for case in range(count):
        inputs, forcing, params = _inputs(rng, case), _forcing(rng, case), _params(rng, case)
        state = _solve(inputs, forcing, params)
        expected = {_camel(name): _plain(getattr(state, name)[0])
                    for name in ("t_surface", "rn", "h", "le", "dqs", "qf", "residual", "converged",
                                 "stability_fallback", "t_cell")}
        cases.append({
            "inputs": {_camel(name): _plain(value) for name, value in inputs.items()},
            "forcing": {_camel(name): _plain(value) for name, value in forcing.items()},
            "params": {_camel(name): value for name, value in params.items()},
            "expected": expected,
        })
    return {"tiles": list(TILES), "seed": seed, "cases": cases}


def to_json(golden):
    """One case per line: small diffs when the physics changes, without a line per number."""
    head = json.dumps({key: value for key, value in golden.items() if key != "cases"})[:-1]
    cases = ",\n".join(json.dumps(case) for case in golden["cases"])
    return f'{head}, "cases": [\n{cases}\n]}}\n'


def main():
    golden = build_cases()
    GOLDEN_PATH.write_text(to_json(golden), encoding="utf-8")
    cases = golden["cases"]
    t_air = np.array([c["forcing"]["tAir"] + c["params"]["dTAir"] for c in cases])[:, None]
    t_surface = np.array([c["expected"]["tSurface"] for c in cases])
    present = np.array([c["inputs"]["fraction"] for c in cases]) > 0
    print(f"{len(cases)} cases -> {GOLDEN_PATH}")
    print(f"tiles present: {present.sum()}, stable (T < Ta): {(present & (t_surface < t_air)).sum()}, "
          f"unstable: {(present & (t_surface > t_air)).sum()}")
    print(f"not converged: {sum(not ok for c in cases for ok in c['expected']['converged'])}, "
          f"stability fallback: {sum(f for c in cases for f in c['expected']['stabilityFallback'])}")


if __name__ == "__main__":
    main()
