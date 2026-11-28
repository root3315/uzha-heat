import math

import numpy as np

from pipeline import landcover


def test_mercator_pixels_are_ten_metres_on_the_ground():
    raster = landcover.mercator_raster((69.0, 41.0, 69.1, 41.1))
    ground = raster.res * math.cos(math.radians(41.05))
    assert abs(ground - landcover.GROUND_RES_M) < 1e-6
    assert raster.crs.to_epsg() == 3857


def test_paint_leaves_outside_transparent_and_counts_shares_inside():
    codes = np.array([[10, 50, 50, 80], [50, 50, 0, 10]], dtype=np.uint8)
    inside = np.array([[True, True, True, True], [True, True, True, False]])
    picture, legend = landcover.paint(codes, inside)

    index = np.array(picture)
    assert index[1, 3] == 0, "outside the city"
    assert index[1, 2] == 0, "no data"
    assert picture.info["transparency"] == 0
    shares = {c["key"]: c["share"] for c in legend}
    assert shares.keys() == {"trees", "built", "water"}
    assert abs(shares["built"] - 4 / 6) < 1e-4 and abs(shares["trees"] - 1 / 6) < 1e-4
    assert all(c["color"].startswith("#") and len(c["color"]) == 7 for c in legend)


def test_rare_classes_fold_into_common_ones():
    assert landcover.CLASSES[70][0] == "bare"
    assert landcover.CLASSES[100][0] == "grass"
    assert len(set(landcover.KEYS)) == len(landcover.KEYS)
