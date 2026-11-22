import json
import math
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from pipeline.uzha.seb import inputs
from pipeline.uzha.seb.types import TILE, TILES, Forcing, SebInputs

RNG = np.random.default_rng(7)


def _random_cells(n=500):
    tree = RNG.uniform(0, 60, n)
    built = RNG.uniform(0, 100 - tree)
    bare = RNG.uniform(0, 100 - tree - built)
    height = RNG.choice([0.0, 4.0, 9.0, 30.0], n)
    volume = RNG.uniform(0, 0.6, n) * height * inputs.M2_PER_HA
    return dict(tree=tree, built=built, bare=bare, water=RNG.uniform(0, 0.3, n),
                roof=inputs.roof_share(volume, height), road=RNG.uniform(0, 0.4, n), height=height, volume=volume)


def _fractions(cells):
    return inputs.tile_fractions(cells["tree"], cells["built"], cells["bare"], cells["water"], cells["roof"],
                                 cells["road"])


def test_fractions_are_non_negative_and_sum_to_one():
    f = _fractions(_random_cells())
    assert f.shape[1] == len(TILES)
    assert (f >= 0).all()
    np.testing.assert_allclose(f.sum(axis=1), 1.0, atol=1e-12)


def test_roof_and_road_fit_inside_built_and_paved_is_the_rest():
    f = inputs.tile_fractions([10], [50], [0], [0], [0.3], [0.4])
    assert f[0, TILE["roof"]] == pytest.approx(0.3)
    assert f[0, TILE["road"]] == pytest.approx(0.2)  # cut to built − roof
    assert f[0, TILE["paved"]] == pytest.approx(0.0)
    assert f[0, TILE["grass"]] == pytest.approx(0.4)


def test_roof_share_is_volume_over_height():
    assert inputs.roof_share([0.25 * 12 * 1e4, 5000], [12, 0]).tolist() == [pytest.approx(0.25), 0.0]


def test_inverted_albedo_reproduces_the_cell_albedo_where_not_clipped():
    cells = _random_cells()
    f = _fractions(cells)
    cell_albedo = RNG.uniform(0.12, 0.30, len(f))
    a = inputs.albedo_matrix(cell_albedo, f)
    a_imp = a[:, TILE["roof"]]
    f_imp = f[:, [TILE[t] for t in ("roof", "road", "paved")]].sum(axis=1)
    low, high = inputs.IMPERVIOUS_ALBEDO_RANGE
    free = (f_imp >= inputs.MIN_IMPERVIOUS_FOR_INVERSION) & (a_imp > low) & (a_imp < high)
    assert free.sum() > 50
    np.testing.assert_allclose((f * a).sum(axis=1)[free], cell_albedo[free], atol=1e-12)
    assert ((a_imp >= low) & (a_imp <= high)).all()


def test_ah4guc_redistribution_keeps_the_1km_total():
    pixel_id = np.array([1, 1, 1, 1, 2, 2, 3])
    pixel_qf = np.array([40.0, 40, 40, 40, 10, 10, 25])
    volume = np.array([0.0, 1000, 3000, 6000, 0, 0, 500])
    qf = inputs.redistribute_by_volume(pixel_qf, pixel_id, volume)
    for pid in (1, 2, 3):
        cells = pixel_id == pid
        assert qf[cells].sum() == pytest.approx(pixel_qf[cells].sum())
    assert qf[0] == 0.0 and qf[3] == pytest.approx(2 * qf[2])
    np.testing.assert_allclose(qf[4:6], 10.0)  # no buildings: spread evenly


def test_ah4guc_pixel_index_matches_the_global_grid():
    row, col = inputs.ah4guc_index([69.2797, -179.999], [41.3111, 89.999])
    assert (row[0], col[0]) == (5842, 29913)  # 90 − 41.3111 = 48.6889° → 5842.67; 249.2797° → 29913.56
    assert (row[1], col[1]) == (0, 0)


def test_opendap_ascii_is_parsed():
    text = "Dataset: x\nband_1.band_1[0], 1479142, 2668568\nband_1.band_1[1], 2948175, 3300237\n"
    np.testing.assert_array_equal(inputs.parse_opendap_ascii(text), [[1479142, 2668568], [2948175, 3300237]])


def test_lapse_correction_cools_higher_cells():
    t = inputs.lapse_corrected(300.0, 450.0, [350.0, 450.0, 550.0])
    np.testing.assert_allclose(t, [300.65, 300.0, 299.35])


def test_sky_view_is_within_bounds_and_falls_with_aspect():
    aspect = np.array([0.0, 0.5, 1.0, 3.0, inputs.MAX_ASPECT])
    svf = inputs.sky_view(aspect)
    assert svf[0] == 1.0 and (svf > 0).all() and (svf <= 1).all()
    assert (np.diff(svf) < 0).all()
    assert svf[2] == pytest.approx(math.cos(math.atan(2.0)))


def test_canyon_shade_limits():
    zenith = math.radians(30)
    shade = inputs.canyon_shade(np.array([0.0, 0.5, 2.0, 50.0]), zenith)
    assert shade[0] == 0.0
    assert shade[1] == pytest.approx(2 / math.pi * 0.5 * math.tan(zenith))  # shallow canyon: 2a/π
    assert (np.diff(shade) > 0).all() and shade[-1] <= 1.0


def test_macdonald_matches_the_paper_limits():
    z0, zd = inputs.macdonald([10.0, 10.0], [0.0, 1.0], [0.0, 1.0])
    assert zd.tolist() == [0.0, pytest.approx(10.0)] and z0.tolist() == [0.0, pytest.approx(0.0)]
    z0, zd = inputs.macdonald([10.0], [0.25], [0.25])
    assert 0.0 < zd[0] < 10.0 and 0.5 < z0[0] < 2.0  # ~ z0/H 0.1 near the peak of the curve


def test_roughness_is_positive_and_below_height():
    cells = _random_cells()
    f = _fractions(cells)
    side = inputs.building_side(f[:, TILE["roof"]], np.full(len(f), 5.0))
    z0, zd = inputs.roughness(f, cells["height"], side)
    assert (z0 > 0).all() and (zd >= 0).all()
    assert (zd <= np.maximum(cells["height"], inputs.TREE_HEIGHT_M)).all()


def test_solar_zenith_at_tashkent_midsummer_noon():
    # 21 June, solar noon at 69.28° E is ~07:23 UTC: zenith ≈ latitude − declination = 41.31 − 23.44
    sun = inputs.solar_position(41.31, 69.28, 172, 12 - 69.28 / 15 + 0.03)
    assert math.degrees(sun["zenith"]) == pytest.approx(17.9, abs=0.3)
    assert inputs.clear_sky_tendency(800.0, inputs.solar_position(41.31, 69.28, 190, 5.9)) > 0  # rising sun


def test_wind_grows_with_height():
    assert inputs.wind_at(2.0, 10.0) == pytest.approx(2.0)
    assert inputs.wind_at(2.0) > 2.0


def test_at_moments_interpolates_in_time():
    series = {"time": ["2024-07-03T05:00", "2024-07-03T06:00"], "a": [100.0, 200.0], "dew_point_2m": [10.0, 10.0]}
    out = inputs.at_moments(series, [datetime(2024, 7, 3, 5, 45, tzinfo=timezone.utc)], ("a", "dew_point_2m"))
    assert out["a"] == pytest.approx(175.0)
    assert out["vapour_kpa"] == pytest.approx(1.228, abs=3e-3)  # e_s(10 °C), FAO-56 Annex 2: 1.228 kPa


def test_one_overpass_counts_once():
    series = {"time": ["2024-07-03T05:00", "2024-07-03T06:00", "2024-07-04T05:00", "2024-07-04T06:00"],
              "a": [100.0, 200.0, 300.0, 400.0], "dew_point_2m": [10.0] * 4}
    pass_one = [datetime(2024, 7, 3, 5, 45, 0, tzinfo=timezone.utc), datetime(2024, 7, 3, 5, 45, 24, tzinfo=timezone.utc)]
    out = inputs.at_moments(series, pass_one + [datetime(2024, 7, 4, 5, 45, tzinfo=timezone.utc)], ("a", "dew_point_2m"))
    assert out["count"] == 2
    assert out["a"] == pytest.approx((175.0 + 375.0) / 2, abs=0.1)


def test_road_area_falls_back_when_the_extract_has_no_roads(monkeypatch, tmp_path):
    from pipeline.uzha.grid import Grid

    grid = Grid.from_bbox((69.20, 41.25, 69.23, 41.27), 100)
    way = {"id": 1, "tags": {"highway": "residential"},
           "geometry": [{"lon": 69.21, "lat": 41.26}, {"lon": 69.22, "lat": 41.26}]}
    monkeypatch.setattr(inputs.osmpbf, "download", lambda cache_dir: cache_dir / "x.pbf")
    monkeypatch.setattr(inputs.osmpbf, "roads", lambda path, bbox, types: [])
    monkeypatch.setattr(inputs.osm, "overpass", lambda query: [way])
    area = inputs.fetch_road_area(grid.bbox_lonlat(), grid, tmp_path)
    assert area.sum() > 0


def _mock_city(monkeypatch, tmp_path):
    """A six-cell Tashkent JSON in tmp_path and every download of inputs.build replaced by a constant."""
    n = 6
    lon = 69.2797 + 0.004 * np.arange(n)
    lat = np.full(n, 41.3111)
    values = {"tree": [10, 20, 0, 50, 5, 0], "built": [80, 60, 100, 20, 90, 0], "bare": [0, 5, 0, 0, 0, 90],
              "roads": [10, 20, 5, 0, 15, 0], "buildings": [8, 4, 2, 0, 12, 0], "height": [9, 15, 40, 0, 6, 0],
              "volume": [27000, 45000, 160000, 0, 18000, 0], "water_dist": [300, 50, 900, 20, 400, 2000],
              "elevation": [420, 440, 460, 430, 450, 470], "ndvi": [0.2, 0.3, 0.1, 0.6, 0.15, 0.05],
              "albedo": [0.2, 0.19, 0.22, 0.16, 0.21, 0.27]}
    document = {"city": {"id": "tashkent", "center": [69.2797, 41.3111], "bbox": [69.1, 41.1, 69.5, 41.4]},
                "period": {"label": "июнь–август 2023–2025"}, "grid": {"cellSizeM": 200},
                "cells": {"lon": lon.tolist(), "lat": lat.tolist(), "lst": [45, 43, 47, 35, 46, 50],
                          "values": values}}
    (tmp_path / "tashkent.json").write_text(json.dumps(document), encoding="utf-8")

    moments = [datetime(2024, 7, 3, 5, 50, tzinfo=timezone.utc), datetime(2024, 8, 4, 5, 55, tzinfo=timezone.utc)]
    start = datetime(2024, 7, 3)
    hours = [start + timedelta(hours=h) for h in range(24 * 33)]

    def hourly(lon, lat, s, e, variables=(), model="era5", timezone="GMT", **_):
        series = {"time": [h.strftime("%Y-%m-%dT%H:%M") for h in hours], "point": [69.25, 41.25], "elevation": 449.0}
        fill = {"temperature_2m": 30.0, "dew_point_2m": 10.0, "wind_speed_10m": 1.5, "surface_pressure": 955.0,
                "shortwave_radiation_instant": 850.0, "direct_normal_irradiance_instant": 860.0,
                "diffuse_radiation_instant": 140.0, "soil_moisture_0_to_7cm": 0.17}
        series.update({v: [fill[v]] * len(hours) for v in variables})
        return series

    monkeypatch.setattr(inputs.weather, "landsat_moments", lambda bbox, label: moments)
    monkeypatch.setattr(inputs.era5, "hourly", hourly)
    monkeypatch.setattr(inputs, "fetch_water_share", lambda bbox, grid: np.full(grid.shape, 0.02))
    monkeypatch.setattr(inputs, "fetch_road_area", lambda bbox, grid: np.full(grid.shape, 0.15))
    monkeypatch.setattr(inputs, "fetch_ah4guc", lambda window: np.full((window[1] - window[0] + 1,
                                                                        window[3] - window[2] + 1), 30.0))


def test_build_with_mocked_downloads(monkeypatch, tmp_path):
    _mock_city(monkeypatch, tmp_path)
    seb, force, lst_k, inside = inputs.build("tashkent", tmp_path, tmp_path / "cache", moisture=False)
    assert isinstance(seb, SebInputs) and isinstance(force, Forcing)
    np.testing.assert_allclose(seb.fraction.sum(axis=1), 1.0)
    np.testing.assert_allclose(lst_k[0], 318.15)
    assert inside.all() and not seb.rural.any() and seb.irrigated.all()
    assert seb.soil_moisture[0] == pytest.approx(0.17)
    assert np.mean(seb.qf) == pytest.approx(30.0)  # one or two 1 km pixels at 30 W/m², mean kept
    assert force.t_air[0] > force.t_air[-1]  # lower cell is warmer
    assert force.diffuse_fraction[0] == pytest.approx(140 / 850)
    assert 20 < math.degrees(force.zenith) < 40 and force.dk_dt > 0
    assert (tmp_path / "cache" / "seb" / "tashkent_summary.json").exists()


def test_build_takes_soil_moisture_and_irrigation_from_the_sentinel_2_wetness(monkeypatch, tmp_path):
    _mock_city(monkeypatch, tmp_path)

    def surface_moisture(bbox, grid):
        wetness = np.full(grid.shape, 0.1, dtype=np.float32)
        wetness[:, ::2] = np.nan  # every other column without clear land pixels
        return {"ndmi": np.zeros(grid.shape), "wetness": wetness, "ndvi": np.zeros(grid.shape), "edges": {},
                "scenes": 3}

    monkeypatch.setattr(inputs, "fetch_surface_moisture", surface_moisture)
    seb, _, _, inside = inputs.build("tashkent", tmp_path, tmp_path / "cache", moisture=True)
    measured = ~np.isclose(seb.soil_moisture, 0.17)
    assert inside.all() and measured.any() and not measured.all()
    np.testing.assert_allclose(seb.soil_moisture[measured], inputs.THETA_AIR_DRY + 0.1 * (0.439 - 0.03), rtol=1e-6)
    assert not seb.irrigated[measured].any()  # dry by SWIR: watering is no longer assumed from the outline
    assert seb.irrigated[~measured].all()  # no W: the outline rule stays
    assert any((tmp_path / "cache" / "seb").glob("*/sentinel2_moisture.pkl"))


def test_wetness_maps_to_theta_between_air_dry_and_saturation():
    theta = inputs.wetness_to_theta([0.0, 0.5, 1.0, 1.7, -0.2, np.nan])
    np.testing.assert_allclose(theta[:5], [0.03, 0.2345, 0.439, 0.439, 0.03])
    assert np.isnan(theta[5])


def test_layer_wetness_from_ndmi_normalises_within_ndvi():
    rng = np.random.default_rng(1)
    vi = rng.uniform(0.1, 0.7, (60, 60))
    ndmi = -0.2 + 0.6 * vi + rng.uniform(0.0, 0.3, vi.shape)  # wetter with greenness, plus a moisture spread
    layer = {"wetness": np.full(vi.shape, 0.5), "ndmi": ndmi, "ndvi": vi}
    w = inputs.layer_wetness(layer, "ndmi")
    assert np.nanmin(w) >= 0.0 and np.nanmax(w) <= 1.0
    spread = ndmi - (-0.2 + 0.6 * vi)
    assert np.corrcoef(w.ravel(), spread.ravel())[0, 1] > 0.95  # W follows the moisture, not the greenness
    np.testing.assert_allclose(inputs.layer_wetness(layer, "optram"), 0.5)
    with pytest.raises(ValueError):
        inputs.layer_wetness(layer, "lst")


def test_cell_moisture_keeps_era5_where_wetness_is_missing_and_can_anchor_to_it():
    wetness = np.array([0.0, 1.0, np.nan, 0.9])
    base = np.array([True, False, True, False])
    theta, irrigated = inputs.cell_moisture(wetness, 0.18, base)
    assert theta[2] == pytest.approx(0.18) and irrigated[2]
    assert irrigated.tolist() == [False, True, True, True]  # θ(0.9) = 0.398 ≥ field capacity 0.347
    assert ((theta >= inputs.THETA_AIR_DRY) & (theta <= inputs.THETA_WET)).all()
    _, flags = inputs.cell_moisture(wetness, 0.18, base, vegetation=False)
    assert flags.tolist() == base.tolist()
    anchored, _ = inputs.cell_moisture(np.array([0.2, 0.4, np.nan]), 0.18, np.ones(3, bool), anchor=True)
    assert anchored[:2].mean() == pytest.approx(0.18) and anchored[1] > anchored[0]


def test_road_area_falls_back_to_overpass_without_the_extract(monkeypatch):
    from pipeline.uzha.grid import Grid

    grid = Grid.from_bbox((69.20, 41.25, 69.23, 41.27), 100)
    way = {"id": 1, "tags": {"highway": "residential"},
           "geometry": [{"lon": 69.21, "lat": 41.26}, {"lon": 69.22, "lat": 41.26}]}

    def no_extract(cache_dir):
        raise OSError("offline")

    monkeypatch.setattr(inputs.osmpbf, "download", no_extract)
    monkeypatch.setattr(inputs.osm, "overpass", lambda query: [way])
    area = inputs.fetch_road_area(grid.bbox_lonlat(), grid)
    assert area.sum() * grid.cell_size ** 2 == pytest.approx(inputs.road_width(way["tags"]) * 840, rel=0.05)
