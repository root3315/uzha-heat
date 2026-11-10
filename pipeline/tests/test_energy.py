import json

import numpy as np
import pytest

from pipeline.uzha import energy

# A Tashkent-like overpass: about 11:00, clear sky.
OVERPASS = {"days": 20, "localHour": 11, "windMs": 1.5, "humidityPct": 31.0, "solarWm2": 800, "cloudPct": 0.3,
            "airC": 32.0}


def _city(n=200, seed=0):
    """Cells from green and cool to bare and hot, with some noise."""
    rng = np.random.default_rng(seed)
    ndvi = np.linspace(0.05, 0.8, n)
    lst = 55.0 - 22.0 * (ndvi - 0.05) / 0.75 + rng.normal(0.0, 1.0, n)
    albedo = 0.22 - 0.07 * ndvi + rng.normal(0.0, 0.01, n)
    return lst, albedo, ndvi


def test_emissivity_follows_the_ndvi_thresholds():
    eps = energy.emissivity(np.array([-0.1, 0.1, 0.2, 0.35, 0.5, 0.9]))
    assert eps[0] == eps[1] == pytest.approx(0.97)
    assert eps[-1] == pytest.approx(0.99)
    assert 0.97 <= eps[3] <= 0.99
    assert np.all(np.diff(eps[1:]) >= -1e-3)


def test_brutsaert_longwave_is_a_clear_summer_sky():
    # 32 °C and 31 % humidity: e_a ≈ 14.7 hPa, ε_a ≈ 0.80, so L↓ near 395 W/m².
    assert energy.vapour_pressure(32.0, 31.0) == pytest.approx(14.7, abs=0.2)
    assert energy.longwave_down(32.0, 31.0) == pytest.approx(395, abs=5)
    assert energy.longwave_down(32.0, 60.0) > energy.longwave_down(32.0, 31.0)


def test_sebal_ground_share_is_bigger_for_hot_bare_surfaces():
    bare = energy.ground_share(np.array([50.0]), np.array([0.2]), np.array([0.1]))[0]
    green = energy.ground_share(np.array([33.0]), np.array([0.15]), np.array([0.8]))[0]
    assert 0.2 < bare < 0.3  # SEBAL gives about a quarter of Rn for dry bare ground at midday
    assert green < 0.1


def test_anchors_and_evaporative_fraction():
    lst, _, ndvi = _city()
    hot, cold = energy.anchors(lst, ndvi)
    assert hot > 50 and cold < 36
    ef = energy.evaporative_fraction(np.array([hot + 1, (hot + cold) / 2, cold - 1]), hot, cold)
    np.testing.assert_allclose(ef, [0.0, 0.5, 1.0])
    with pytest.raises(ValueError):
        energy.evaporative_fraction(lst, 30.0, 35.0)


def test_balance_closes_and_stays_in_plausible_ranges():
    lst, albedo, ndvi = _city()
    flux = energy.balance(lst, albedo, ndvi, OVERPASS["solarWm2"], OVERPASS["airC"], OVERPASS["humidityPct"])
    np.testing.assert_allclose(flux["rn"], flux["g"] + flux["h"] + flux["le"], atol=1e-9)
    # Midday summer net radiation over land is a few hundred W/m² (e.g. Oke 1987, ch. 4).
    assert np.all((flux["rn"] > 300) & (flux["rn"] < 700))
    assert np.all((flux["g"] > 0) & (flux["g"] < 0.4 * flux["rn"]))
    assert np.all(flux["h"] >= -1e-9) and np.all(flux["le"] >= 0)
    assert np.all(flux["sAbs"] < OVERPASS["solarWm2"])
    hot, green = np.argmax(lst), np.argmax(ndvi)
    assert flux["le"][green] > flux["h"][green]
    assert flux["h"][hot] > flux["le"][hot]
    assert flux["rn"][green] > flux["rn"][hot]  # a hot surface loses more as longwave


def test_enrich_file_writes_integer_fluxes_that_close(tmp_path):
    lst, albedo, ndvi = _city(50)
    document = {"city": {"id": "tashkent", "weather": {"overpass": OVERPASS}},
                "cells": {"lst": lst.round(3).tolist(),
                          "values": {"albedo": albedo.round(3).tolist(), "ndvi": ndvi.round(3).tolist()}}}
    path = tmp_path / "tashkent.json"
    path.write_text(json.dumps(document), encoding="utf-8")

    energy.enrich_file(path)

    written = json.loads(path.read_text(encoding="utf-8"))
    cells = written["cells"]["energy"]
    assert set(cells) == set(energy.FLUXES)
    assert all(len(cells[key]) == 50 and all(isinstance(v, int) for v in cells[key]) for key in cells)
    for i in range(50):
        assert cells["rn"][i] == cells["g"][i] + cells["h"][i] + cells["le"][i]
    meta = written["energy"]
    assert meta["localHour"] == 11 and meta["solarWm2"] == 800
    assert meta["hotAnchorC"] > meta["coldAnchorC"]
    assert set(meta["mean"]) == set(energy.FLUXES)
    assert [s["key"] for s in meta["surfaces"]] == ["asphalt", "concrete", "dry_soil", "wet_soil"]


def test_enrich_needs_weather_at_the_overpass():
    with pytest.raises(ValueError, match="--only weather"):
        energy.enrich({"city": {"id": "bukhara"}, "cells": {}})
