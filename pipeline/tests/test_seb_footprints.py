import numpy as np
import pyogrio
import shapely
from pyproj import Transformer

from pipeline.uzha.grid import WGS84, Grid
from pipeline.uzha.seb import inputs


def _square(x, y, side):
    return shapely.box(x, y, x + side, y + side)


def test_footprint_form_sums_roofs_and_weights_height_by_area(tmp_path):
    grid = Grid.from_bbox((69.20, 41.30, 69.21, 41.305), cell_size=200.0)
    x0, top = grid.left, grid.top
    # Two buildings in the first cell (20 m × 20 m at 10 m, 10 m × 10 m at 30 m), none elsewhere.
    metric = [_square(x0 + 10, top - 60, 20), _square(x0 + 100, top - 150, 10)]
    to_wgs = Transformer.from_crs(grid.crs, WGS84, always_xy=True).transform
    lonlat = [shapely.transform(g, lambda xy: np.column_stack(to_wgs(xy[:, 0], xy[:, 1]))) for g in metric]
    path = tmp_path / "city.fgb"
    pyogrio.raw.write(path, shapely.to_wkb(np.array(lonlat)), field_data=[np.array([10.0, 30.0], np.float32)],
                      fields=["h"], geometry_type="Polygon", crs=WGS84.to_string(), driver="FlatGeobuf")

    form = inputs.footprint_form(path, grid)

    assert abs(form["roof"][0, 0] - 500 / 40_000) < 1e-3
    assert abs(form["height"][0, 0] - (400 * 10 + 100 * 30) / 500) < 0.05
    assert abs(form["per_ha"][0, 0] - 2 / 4) < 1e-9
    assert form["roof"].sum() == form["roof"][0, 0]
    assert np.isnan(form["height"][0, 1])
