import numpy as np
import pytest

from pipeline.uzha.sources.landsat import QA_CLOUD, QA_CLOUD_SHADOW, QA_DILATED_CLOUD, clear_sky, dn_to_celsius
from pipeline.uzha.sources.sentinel import liang_albedo, ndvi, to_reflectance


def test_landsat_dn_to_celsius():
    assert dn_to_celsius(np.array([0.0]))[0] == pytest.approx(149.0 - 273.15)
    assert dn_to_celsius(np.array([47000.0]))[0] == pytest.approx(36.497, abs=1e-3)


def test_clear_sky_rejects_fill_cloud_shadow_and_nan():
    clear_value = 21824  # Landsat C2 QA_PIXEL: clear land, low-confidence cloud
    qa = np.array([clear_value, 1, clear_value | QA_CLOUD, clear_value | QA_CLOUD_SHADOW,
                   clear_value | QA_DILATED_CLOUD, np.nan], dtype=np.float32)
    assert clear_sky(qa).tolist() == [True, False, False, False, False, False]


def test_reflectance_offset_depends_on_processing_baseline():
    dn = np.array([2000.0])
    assert to_reflectance(dn, "05.11")[0] == pytest.approx(0.1)
    assert to_reflectance(dn, "04.00")[0] == pytest.approx(0.1)
    assert to_reflectance(dn, "03.01")[0] == pytest.approx(0.2)


def test_ndvi():
    result = ndvi(np.array([0.5, 0.2, 0.0]), np.array([0.1, 0.2, 0.0]))
    assert result[0] == pytest.approx(0.4 / 0.6)
    assert result[1] == 0.0
    assert np.isnan(result[2])


def test_liang_albedo():
    bands = {"B02": 0.1, "B04": 0.2, "B08": 0.3, "B11": 0.4, "B12": 0.5}
    expected = 0.356 * 0.1 + 0.130 * 0.2 + 0.373 * 0.3 + 0.085 * 0.4 + 0.072 * 0.5 - 0.0018
    assert liang_albedo(bands) == pytest.approx(expected)
    uniform = liang_albedo({band: np.full(3, 0.25) for band in bands})
    np.testing.assert_allclose(uniform, np.full(3, 1.016 * 0.25 - 0.0018))
