"""Per-cell inputs of the physics model for the browser: web/public/data/seb-<id>.json.

The place panel solves the energy balance of one picked cell in the browser (web/src/domain/seb/). This writes what
it needs, compactly: the overpass weather (one value for the city where it does not vary, a column where it does),
the parameters fitted by `seb_check` (taken from physics.json, so run that first), the per-tile constants and one
column per input that varies by cell. Columns are fixed-point integers, `value = offset + step × int`, which keeps
Tashkent near 1 MB before gzip.

The browser solves the rounded inputs, so every number the check rows hold is computed from them too: `check` has a
few cells with the Python solver's cell temperature on the decoded inputs, and `roundingK` the largest change of the
cell temperature that the rounding causes over the converged cells.

Usage (from the project root):
    python -m pipeline.seb_export --city tashkent
    python -m pipeline.seb_export --all          # every city that has physics in physics.json

The format is in docs/data-contract.md.
"""
import argparse
import json
import logging
import sys
from dataclasses import fields
from pathlib import Path

import numpy as np

from .uzha.cities import CITIES
from .uzha.export import write_json
from .uzha.seb import inputs as seb_inputs
from .uzha.seb.solve import solve
from .uzha.seb.types import IMPERVIOUS, TILE, TILES, CANYON_FLOOR, Forcing, Params, SebInputs

log = logging.getLogger(__name__)

PIPELINE_DIR = Path(__file__).resolve().parent
DATA_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"
CACHE_ROOT = PIPELINE_DIR / "cache"
PHYSICS_NAME = "physics.json"
FORMAT = "uzha-seb-1"

# Fixed-point step of each column. Chosen so that the rounding moves no converged cell's temperature by more than a
# few hundredths of a kelvin (the file states the actual largest change as roundingK).
FRACTION_UNITS = 1000  # tile shares in thousandths, each cell's shares summing to exactly 1000
STEPS = {
    "imperviousAlbedo": 0.001,
    "canyonShade": 0.001,
    "skyView": 0.001,
    "z0m": 0.00001,  # m: open water is 0.0002 m, and the log wind profile needs it to a few per cent
    "zd": 0.01,  # m
    "soilMoisture": 0.001,  # m³ m⁻³
    "qf": 0.1,  # W m⁻²
    "tAir": 0.01,  # K
    "lDown": 0.1,  # W m⁻²
    "pressure": 0.01,  # kPa
}
FLAGS = ("irrigated", "rural")
CELL_COLUMNS = ("sky_view", "z0m", "zd", "soil_moisture", "qf")
UNIFORM_FORCING = ("k_down", "diffuse_fraction", "e_air", "wind")
VARYING_FORCING = ("t_air", "l_down", "pressure")
SCALARS = ("z_ref", "zenith", "dk_dt")
CHECK_CELLS = 12  # with roofs and roads, spread over the cell temperature; plus two of the ring
CHECK_MIN_SHARE = 0.01  # roofs and roads at least this share of a check cell, so the panel offers changes there
CHECK_RING = 2
DIGITS = 6  # constants


def camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.capitalize() for part in rest)


# ===================================================================================================================
# Columns
# ===================================================================================================================

def encode_column(values, step: float):
    """A number when every cell has the same value, else {offset, step, values} with value = offset + step × int."""
    values = np.asarray(values, float)
    if not np.all(np.isfinite(values)):
        raise ValueError("a column holds a value that is not finite")
    if np.all(values == values[0]):
        return round(float(values[0]), DIGITS)
    offset = round(float(np.floor(values.min() / step) * step), DIGITS)
    ints = np.rint((values - offset) / step).astype(np.int64)
    return {"offset": offset, "step": step, "values": ints.tolist()}


def decode_column(column, n: int) -> np.ndarray:
    """Inverse of encode_column, in the same arithmetic as the browser (offset + step × int)."""
    if isinstance(column, (int, float)):
        return np.full(n, float(column))
    ints = np.asarray(column["values"], float)
    if len(ints) != n:
        raise ValueError(f"column of {len(ints)} values, expected {n}")
    return column["offset"] + column["step"] * ints


def encode_fractions(fraction: np.ndarray) -> dict:
    """Tile shares in thousandths; the largest share of each cell takes the rounding remainder so they sum to 1000."""
    ints = np.rint(fraction * FRACTION_UNITS).astype(np.int64)
    rows = np.arange(len(ints))
    ints[rows, np.argmax(fraction, axis=1)] += FRACTION_UNITS - ints.sum(axis=1)
    if (ints < 0).any():
        raise ValueError("a tile share went negative in the rounding")
    return {tile: encode_column(ints[:, TILE[tile]] / FRACTION_UNITS, 1.0 / FRACTION_UNITS) for tile in TILES}


def _only_value(values, what: str) -> float:
    unique = np.unique(np.asarray(values, float))
    if len(unique) != 1:
        raise ValueError(f"{what} varies by cell; the export keeps it as one value")
    return round(float(unique[0]), DIGITS)


def _shared_column(matrix: np.ndarray, tiles: tuple, what: str) -> np.ndarray:
    """The one value per cell that `tiles` share in `matrix` (n, T)."""
    first = matrix[:, TILE[tiles[0]]]
    if any(not np.array_equal(matrix[:, TILE[t]], first) for t in tiles[1:]):
        raise ValueError(f"{what} differs between {', '.join(tiles)}; the export keeps one value per cell for them")
    return first


# ===================================================================================================================
# Document
# ===================================================================================================================

def encode(inputs: SebInputs, forcing: Forcing, params: Params) -> dict:
    """Everything but the check rows, as a JSON-ready dict."""
    n = len(inputs.z0m)
    natural = tuple(t for t in TILES if t not in IMPERVIOUS)
    others = tuple(t for t in TILES if t not in CANYON_FLOOR)
    if np.any(inputs.shade[:, [TILE[t] for t in others]] != 0):
        raise ValueError(f"shade on {', '.join(others)}: the export only has the canyon floor's shade")
    tile = {
        "emissivity": [_only_value(inputs.emissivity[:, k], f"emissivity of {t}") for k, t in enumerate(TILES)],
        "ohm": [[_only_value(inputs.ohm[:, k, j], f"OHM a{j + 1} of {t}") for j in range(3)]
                for k, t in enumerate(TILES)],
        "albedo": {t: _only_value(inputs.albedo[:, TILE[t]], f"albedo of {t}") for t in natural},
        "imperviousTiles": list(IMPERVIOUS),
        "canyonTiles": list(CANYON_FLOOR),
    }
    cell = {
        "fraction": encode_fractions(inputs.fraction),
        "imperviousAlbedo": encode_column(_shared_column(inputs.albedo, IMPERVIOUS, "albedo"),
                                          STEPS["imperviousAlbedo"]),
        "canyonShade": encode_column(_shared_column(inputs.shade, CANYON_FLOOR, "shade"), STEPS["canyonShade"]),
        **{camel(name): encode_column(getattr(inputs, name), STEPS[camel(name)]) for name in CELL_COLUMNS},
        **{name: encode_column(np.asarray(getattr(inputs, name), bool).astype(float), 1.0) for name in FLAGS},
    }
    weather = {
        **{camel(name): _only_value(getattr(forcing, name), name) for name in UNIFORM_FORCING},
        **{camel(name): encode_column(np.broadcast_to(getattr(forcing, name), n), STEPS[camel(name)])
           for name in VARYING_FORCING},
        **{camel(name): round(float(getattr(forcing, name)), DIGITS) for name in SCALARS},
    }
    return {
        "format": FORMAT,
        "tiles": list(TILES),
        "cells": n,
        "params": {camel(name): float(value) for name, value in zip(Params.BOUNDS, params.vector())},
        "forcing": weather,
        "tile": tile,
        "cell": cell,
    }


def decode(document: dict) -> tuple:
    """(SebInputs, Forcing, Params) from a seb-<id>.json document, as the browser rebuilds them."""
    n = document["cells"]
    tile, cell, weather = document["tile"], document["cell"], document["forcing"]
    if document["tiles"] != list(TILES):
        raise ValueError("tile order differs from the solver's")
    t = len(TILES)
    fraction = np.column_stack([decode_column(cell["fraction"][name], n) for name in TILES])
    albedo = np.zeros((n, t))
    for name, value in tile["albedo"].items():
        albedo[:, TILE[name]] = value
    impervious = decode_column(cell["imperviousAlbedo"], n)
    for name in tile["imperviousTiles"]:
        albedo[:, TILE[name]] = impervious
    shade = np.zeros((n, t))
    floor = decode_column(cell["canyonShade"], n)
    for name in tile["canyonTiles"]:
        shade[:, TILE[name]] = floor
    inputs = SebInputs(
        fraction=fraction,
        albedo=albedo,
        emissivity=np.tile(np.asarray(tile["emissivity"], float), (n, 1)),
        shade=shade,
        ohm=np.tile(np.asarray(tile["ohm"], float), (n, 1, 1)),
        irrigated=decode_column(cell["irrigated"], n) > 0.5,
        rural=decode_column(cell["rural"], n) > 0.5,
        **{name: decode_column(cell[camel(name)], n) for name in CELL_COLUMNS},
    )
    forcing = Forcing(
        **{name: np.full(n, float(weather[camel(name)])) for name in UNIFORM_FORCING},
        **{name: decode_column(weather[camel(name)], n) for name in VARYING_FORCING},
        **{name: float(weather[camel(name)]) for name in SCALARS},
    )
    params = Params(**{name: float(document["params"][camel(name)]) for name in Params.BOUNDS})
    return inputs, forcing, params


def cell_inputs(document: dict, cell: int) -> tuple:
    """One cell in the browser's shape: (CellInputs, CellForcing) as dicts with the TypeScript field names."""
    inputs, forcing, _ = decode(document)
    one = {camel(f.name): np.asarray(getattr(inputs, f.name))[cell].tolist() for f in fields(SebInputs)}
    weather = {camel(f.name): (np.asarray(getattr(forcing, f.name))[cell].item()
                               if np.ndim(getattr(forcing, f.name)) else float(getattr(forcing, f.name)))
               for f in fields(Forcing)}
    return one, weather


def check_cells(inputs: SebInputs, state, count: int = CHECK_CELLS, ring: int = CHECK_RING) -> list:
    """Converged cells with roofs and roads at evenly spaced ranks of the cell temperature, and a few ring cells."""
    ok = state.converged.all(axis=1)
    built = (ok & (inputs.fraction[:, TILE["roof"]] >= CHECK_MIN_SHARE) & (inputs.fraction[:, TILE["road"]] >= CHECK_MIN_SHARE)
             & ~inputs.rural)
    picked = []
    for pool, take in ((np.flatnonzero(built), count), (np.flatnonzero(ok & inputs.rural), ring)):
        if len(pool) == 0:
            continue
        ranked = pool[np.argsort(state.t_cell[pool], kind="stable")]
        picked.extend(int(c) for c in ranked[np.unique(np.linspace(0, len(ranked) - 1, take).round().astype(int))])
    return picked


def build_document(inputs: SebInputs, forcing: Forcing, params: Params) -> dict:
    """The file's contents: the encoded inputs, check rows solved on the decoded inputs and the rounding effect."""
    document = encode(inputs, forcing, params)
    # Round-trip through JSON: the check is computed on exactly the numbers the browser reads.
    document = json.loads(json.dumps(document))
    decoded, decoded_forcing, decoded_params = decode(document)
    state = solve(decoded, decoded_forcing, decoded_params)
    exact = solve(inputs, forcing, params)
    ok = state.converged.all(axis=1) & exact.converged.all(axis=1)
    cells = check_cells(decoded, state)
    document["check"] = {"cells": cells, "tCell": [round(float(state.t_cell[c]), 6) for c in cells]}
    document["roundingK"] = round(float(np.max(np.abs(state.t_cell[ok] - exact.t_cell[ok]))), 4) if ok.any() else None
    return document


def fitted_params(city_id: str, data_dir: Path) -> Params:
    """The parameters `seb_check` fitted for the city, from physics.json; None when the city has no physics yet."""
    path = Path(data_dir) / PHYSICS_NAME
    if not path.exists():
        return None
    city = json.loads(path.read_text(encoding="utf-8")).get(city_id)
    if not city or "params" not in city:
        return None
    return Params(**{name: float(city["params"][name]) for name in Params.BOUNDS})


def export(city_id: str, data_dir: Path = DATA_DIR, cache_root: Path = CACHE_ROOT) -> Path:
    params = fitted_params(city_id, data_dir)
    if params is None:
        raise LookupError(f"{city_id}: no fitted parameters in {PHYSICS_NAME}; run pipeline.seb_check first")
    inputs, forcing, _, _ = seb_inputs.build(city_id, data_dir, cache_root)
    document = build_document(inputs, forcing, params)
    path = Path(data_dir) / f"seb-{city_id}.json"
    write_json(path, document)
    log.info("%s: %d cells, %.0f kB, rounding moves the cell temperature by at most %s K", city_id,
             document["cells"], path.stat().st_size / 1024, document["roundingK"])
    return path


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--city", choices=list(CITIES))
    target.add_argument("--all", action="store_true")
    parser.add_argument("--cache-root", type=Path, default=CACHE_ROOT)
    args = parser.parse_args()
    cities = [c for c in CITIES if fitted_params(c, DATA_DIR) is not None] if args.all else [args.city]
    for city_id in cities:
        print(f"written: {export(city_id, cache_root=args.cache_root)}")


if __name__ == "__main__":
    main()
