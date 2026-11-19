import json

import numpy as np
import pytest
from pyproj import Transformer

from pipeline.uzha.grid import WGS84, Raster
from pipeline.uzha.night import FORMAT, keep_within, lon_lat, night_document, pixel_centres_lonlat
from pipeline.uzha.sources.modis import PIXEL_M, SINUSOIDAL, ModisLst, modis_raster

BBOX = (69.1, 41.2, 69.4, 41.4)


def _product(night: np.ndarray, raster: Raster) -> ModisLst:
    return ModisLst(raster=raster, day=night + 15, night=night, day_count=np.full(night.shape, 9),
                    night_count=np.full(night.shape, 9), composites=24)


def test_lon_lat_matches_pyproj_inverse_sinusoidal():
    to_lonlat = Transformer.from_crs(SINUSOIDAL, WGS84, always_xy=True).transform
    for x, y in [(5_748_784.0, 4_614_594.0), (5_600_000.0, 4_430_000.0)]:
        assert lon_lat(x, y) == pytest.approx(to_lonlat(x, y), abs=1e-9)


def test_pixel_centres_are_half_a_pixel_in():
    lon, lat = pixel_centres_lonlat(5_748_784.0, 4_614_594.0, PIXEL_M, (2, 3))
    assert lon.shape == lat.shape == (2, 3)
    assert (lon[0, 0], lat[0, 0]) == pytest.approx(lon_lat(5_748_784.0 + PIXEL_M / 2, 4_614_594.0 - PIXEL_M / 2))
    assert lat[0, 0] > lat[1, 0] and lon[0, 1] > lon[0, 0]


def test_keep_within_blanks_pixels_whose_centre_is_outside_the_box():
    raster = modis_raster(BBOX)
    night = np.full(raster.shape, 20.0)
    kept = keep_within(night, raster.transform.c, raster.transform.f, raster.transform.a, BBOX)
    lon, lat = pixel_centres_lonlat(raster.transform.c, raster.transform.f, raster.transform.a, raster.shape)
    inside = (lon >= BBOX[0]) & (lon <= BBOX[2]) & (lat >= BBOX[1]) & (lat <= BBOX[3])
    assert inside.any() and (~inside).any()  # the sheared sinusoidal box reaches past the lon/lat box
    assert np.all(kept[inside] == 20.0) and np.all(np.isnan(kept[~inside]))


def test_night_document_is_the_contract():
    raster = modis_raster(BBOX)
    night = np.linspace(15.0, 24.0, raster.shape[0] * raster.shape[1]).reshape(raster.shape).astype(np.float32)
    night[0, :] = np.nan  # too few composites
    doc = night_document(_product(night, raster), "июнь–август 2023–2025", BBOX)
    json.dumps(doc, allow_nan=False)  # valid JSON: no NaN anywhere
    assert doc["format"] == FORMAT
    assert doc["product"] == "MYD11A2" and doc["band"] == "LST_Night_1km" and doc["overpassLocal"] == "~01:30"
    grid = doc["grid"]
    assert (grid["nx"], grid["ny"]) == (raster.shape[1], raster.shape[0])
    assert grid["pixelM"] == pytest.approx(PIXEL_M)
    assert grid["x0"] == pytest.approx(raster.transform.c, abs=1e-3) and grid["y0"] == pytest.approx(raster.transform.f, abs=1e-3)
    values = doc["values"]
    assert len(values) == grid["nx"] * grid["ny"]
    assert all(v is None for v in values[: grid["nx"]])
    kept = [v for v in values if v is not None]
    assert kept and all(v == round(v, 1) for v in kept)
    assert doc["stats"]["min"] == min(kept) and doc["stats"]["max"] == max(kept)
    west, south, east, north = doc["bounds"]
    assert west < BBOX[0] < BBOX[2] < east and south <= BBOX[1] and north >= BBOX[3]


def test_night_document_refuses_an_empty_grid():
    raster = modis_raster(BBOX)
    with pytest.raises(ValueError):
        night_document(_product(np.full(raster.shape, np.nan), raster), "p", BBOX)

