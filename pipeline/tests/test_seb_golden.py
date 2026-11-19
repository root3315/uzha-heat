"""The golden cases of the TypeScript solver port (web/src/domain/seb/golden.json) match the Python solver.

When this fails after a physics change, regenerate the file with `python -m pipeline.seb_golden` and port the same
change to web/src/domain/seb/, whose vitest test replays the file.
"""
import json

import numpy as np
import pytest

from pipeline.seb_golden import GOLDEN_PATH, build_cases

# Loose enough for numpy/libm differences between machines, far tighter than any physics change.
ABS_TOLERANCE = 1e-6


def _compare(actual, expected, path="golden"):
    if isinstance(expected, dict):
        assert set(actual) == set(expected), f"{path}: keys differ"
        for key in expected:
            _compare(actual[key], expected[key], f"{path}.{key}")
    elif isinstance(expected, list) and expected and isinstance(expected[0], (dict, list, str)):
        assert len(actual) == len(expected), f"{path}: length differs"
        for index, (a, e) in enumerate(zip(actual, expected)):
            _compare(a, e, f"{path}[{index}]")
    elif isinstance(expected, (bool, str)) or (isinstance(expected, list) and isinstance(expected[0], bool)):
        assert actual == expected, f"{path}: {actual} != {expected}"
    else:
        np.testing.assert_allclose(actual, expected, rtol=0, atol=ABS_TOLERANCE, err_msg=path)


@pytest.fixture(scope="module")
def golden_file():
    return json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))


def test_golden_file_matches_python_solver(golden_file):
    # Round-trip through JSON so both sides hold the same plain types.
    _compare(json.loads(json.dumps(build_cases())), golden_file)


def test_golden_cases_cover_the_regimes(golden_file):
    cases = golden_file["cases"]
    present = np.array([c["inputs"]["fraction"] for c in cases]) > 0
    t_air = np.array([c["forcing"]["tAir"] + c["params"]["dTAir"] for c in cases])[:, None]
    t_surface = np.array([c["expected"]["tSurface"] for c in cases])
    assert len(cases) >= 40
    assert (present & (t_surface < t_air)).sum() >= 10  # stable tiles
    assert (present & (t_surface > t_air)).sum() >= 10  # unstable tiles
    assert any(c["forcing"]["wind"] == 0.0 for c in cases)  # calm
    assert present.any(axis=0).all()  # every tile appears
