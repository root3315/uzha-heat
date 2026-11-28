"""seb-<id>.json, the per-cell physics inputs for the browser: compact encoding, round trip, check rows.

The browser rebuilds CellInputs / CellForcing (web/src/domain/seb/types.ts) from the file; `cell_inputs` does the same
in Python, so the field names and the solved temperature are checked here and replayed by vitest
(web/src/data/seb.test.ts) on the shipped file.
"""
import json

import numpy as np
import pytest

from pipeline import seb_export
from pipeline.uzha.seb.solve import solve
from pipeline.uzha.seb.types import CANYON_FLOOR, IMPERVIOUS, TILE, TILES, Forcing, Params, SebInputs

# The TypeScript shapes (web/src/domain/seb/types.ts).
CELL_INPUTS_KEYS = {"fraction", "albedo", "emissivity", "shade", "skyView", "z0m", "zd", "soilMoisture", "irrigated",
                    "ohm", "qf", "rural"}
CELL_FORCING_KEYS = {"kDown", "diffuseFraction", "lDown", "tAir", "eAir", "pressure", "wind", "zRef", "zenith", "dkDt"}
PARAMS_KEYS = {"kbInv", "rsMinTree", "rsMinGrass", "rsMinCrop", "soilResistanceScale", "ohmA1Scale", "dTAir", "dTAirUrban"}

OHM = [[0.11, 0.11, -12.3], [0.32, 0.54, -27.4], [0.35, 0.43, -36.5], [0.48, 0.34, -33.9], [0.61, 0.41, -27.7],
       [0.83, 0.40, -54.2], [0.50, 0.21, -39.1]]


def _city(n=60, seed=3):
    """A small city built the way inputs.build builds one: per-tile constants, one impervious albedo and one canyon
    shade per cell, the air temperature varying with elevation."""
    rng = np.random.default_rng(seed)
    t = len(TILES)
    fraction = rng.uniform(0, 1, (n, t)) ** 2
    fraction[rng.uniform(size=(n, t)) < 0.3] = 0.0
    fraction[:, TILE["roof"]] += 0.2
    fraction /= fraction.sum(axis=1, keepdims=True)
    albedo = np.tile([0.16, 0.21, 0.25, 0.0, 0.0, 0.0, 0.08], (n, 1))
    albedo[:, [TILE[k] for k in IMPERVIOUS]] = rng.uniform(0.08, 0.45, (n, 1))
    shade = np.zeros((n, t))
    shade[:, [TILE[k] for k in CANYON_FLOOR]] = rng.uniform(0, 0.6, (n, 1))
    rural = rng.uniform(size=n) < 0.3
    inputs = SebInputs(fraction=fraction, albedo=albedo, emissivity=np.tile([0.98, 0.95, 0.93, 0.91, 0.95, 0.9, 0.96],
                                                                            (n, 1)),
                       shade=shade, sky_view=rng.uniform(0.3, 1, n), z0m=np.exp(rng.uniform(-8, 0.5, n)),
                       zd=rng.uniform(0, 12, n), soil_moisture=np.full(n, 0.21), irrigated=~rural | (rng.uniform(size=n) < 0.2),
                       ohm=np.tile(np.array(OHM), (n, 1, 1)), qf=rng.uniform(0, 60, n), rural=rural)
    t_air = 305.0 - 0.0065 * rng.uniform(0, 200, n)
    forcing = Forcing(k_down=np.full(n, 840.5), diffuse_fraction=np.full(n, 0.16), l_down=390 + 2 * (t_air - 304),
                      t_air=t_air, e_air=np.full(n, 1.45), pressure=95.5 + 0.1 * (t_air - 304), wind=np.full(n, 2.13),
                      z_ref=60.0, zenith=0.527, dk_dt=66.7)
    return inputs, forcing, Params(kb_inv=6.44, rs_min_tree=40.0, d_t_air=4.6)


@pytest.fixture(scope="module")
def city():
    return _city()


@pytest.fixture(scope="module")
def document(city):
    # Through JSON text, as the browser receives it.
    return json.loads(json.dumps(seb_export.build_document(*city), allow_nan=False))


def test_column_is_one_number_when_every_cell_agrees():
    assert seb_export.encode_column(np.full(5, 0.2134567), 0.001) == 0.213457
    np.testing.assert_array_equal(seb_export.decode_column(0.5, 3), [0.5, 0.5, 0.5])


def test_column_round_trip_within_half_a_step():
    values = np.array([304.2746, 305.6770, 304.9, 305.0049])
    column = seb_export.encode_column(values, 0.01)
    assert all(isinstance(v, int) for v in column["values"])
    np.testing.assert_allclose(seb_export.decode_column(column, 4), values, atol=0.005 + 1e-9)


def test_column_of_the_wrong_length_is_refused():
    with pytest.raises(ValueError):
        seb_export.decode_column({"offset": 0, "step": 1, "values": [1, 2]}, 3)


def test_fractions_sum_to_one_in_thousandths(city):
    inputs, _, _ = city
    encoded = seb_export.encode_fractions(inputs.fraction)
    ints = np.column_stack([np.rint(seb_export.decode_column(encoded[t], len(inputs.z0m)) * 1000) for t in TILES])
    assert np.all(ints.sum(axis=1) == 1000)
    # Each share within half a thousandth, the largest one also carries the remainder of the others.
    np.testing.assert_allclose(ints / 1000, inputs.fraction, atol=0.0035 + 1e-9)


def test_decode_rebuilds_the_inputs(city, document):
    inputs, forcing, params = city
    decoded, decoded_forcing, decoded_params = seb_export.decode(document)
    np.testing.assert_allclose(decoded.albedo, inputs.albedo, atol=0.0005 + 1e-9)
    np.testing.assert_allclose(decoded.shade, inputs.shade, atol=0.0005 + 1e-9)
    np.testing.assert_allclose(decoded.z0m, inputs.z0m, atol=0.000005 + 1e-12)
    np.testing.assert_allclose(decoded.qf, inputs.qf, atol=0.05 + 1e-9)
    np.testing.assert_array_equal(decoded.emissivity, inputs.emissivity)
    np.testing.assert_array_equal(decoded.ohm, inputs.ohm)
    np.testing.assert_array_equal(decoded.irrigated, inputs.irrigated)
    np.testing.assert_array_equal(decoded.rural, inputs.rural)
    np.testing.assert_allclose(decoded_forcing.t_air, forcing.t_air, atol=0.005 + 1e-9)
    np.testing.assert_allclose(decoded_forcing.l_down, forcing.l_down, atol=0.05 + 1e-9)
    assert decoded_forcing.zenith == forcing.zenith
    assert decoded_params == params
    assert isinstance(document["forcing"]["kDown"], float)  # the same for every cell: one number, not a column


def test_rounding_barely_moves_the_temperature(document):
    assert document["roundingK"] < 0.05


def test_cell_has_the_browser_shape(document):
    inputs, forcing = seb_export.cell_inputs(document, 0)
    assert set(inputs) == CELL_INPUTS_KEYS
    assert set(forcing) == CELL_FORCING_KEYS
    assert set(document["params"]) == PARAMS_KEYS
    assert len(inputs["fraction"]) == len(TILES) and len(inputs["ohm"]) == len(TILES)
    assert isinstance(inputs["irrigated"], bool) and isinstance(forcing["zRef"], float)


def _solve_one(inputs: dict, forcing: dict, params: dict) -> float:
    """Solve a cell given in the browser's shape, as web/src/domain/seb/solve.ts would."""
    snake = {name: seb_export.camel(name) for name in SebInputs.__dataclass_fields__}
    batch = SebInputs(**{name: np.asarray(inputs[key])[None, ...] for name, key in snake.items()})
    weather = Forcing(**{name: forcing[seb_export.camel(name)] for name in Forcing.__dataclass_fields__})
    return float(solve(batch, weather, Params(**{n: params[seb_export.camel(n)] for n in Params.BOUNDS})).t_cell[0])


def test_check_rows_are_the_solver_on_the_decoded_cell(document):
    check = document["check"]
    assert 3 <= len(check["cells"]) == len(check["tCell"])
    for cell, expected in zip(check["cells"], check["tCell"]):
        inputs, forcing = seb_export.cell_inputs(document, cell)
        assert _solve_one(inputs, forcing, document["params"]) == pytest.approx(expected, abs=1e-5)


def test_check_cells_have_roofs_and_roads_and_include_the_ring(city, document):
    decoded, _, _ = seb_export.decode(document)
    cells = np.array(document["check"]["cells"])
    town = cells[~decoded.rural[cells]]
    assert np.all(decoded.fraction[town, TILE["roof"]] > 0) and np.all(decoded.fraction[town, TILE["road"]] > 0)
    assert decoded.rural[cells].any()


def test_a_per_cell_emissivity_is_refused(city):
    inputs, forcing, params = city
    emissivity = inputs.emissivity.copy()
    emissivity[0, TILE["roof"]] = 0.8
    with pytest.raises(ValueError, match="emissivity"):
        seb_export.encode(SebInputs(**{**inputs.__dict__, "emissivity": emissivity}), forcing, params)


def test_shipped_files_match_the_solver():
    """The check rows of every shipped seb-<id>.json still come out of the Python solver (rerun the export after a
    physics change)."""
    paths = sorted(seb_export.DATA_DIR.glob("seb-*.json"))
    if not paths:
        pytest.skip("no seb-<id>.json exported")
    for path in paths:
        document = json.loads(path.read_text(encoding="utf-8"))
        assert document["format"] == seb_export.FORMAT
        decoded, forcing, params = seb_export.decode(document)
        cells = np.array(document["check"]["cells"])
        part = SebInputs(**{name: np.asarray(getattr(decoded, name))[cells] for name in SebInputs.__dataclass_fields__})
        weather = Forcing(**{name: (np.asarray(value)[cells] if np.ndim(value) else value)
                             for name, value in forcing.__dict__.items()})
        np.testing.assert_allclose(solve(part, weather, params).t_cell, document["check"]["tCell"], atol=1e-5,
                                   err_msg=path.name)
