import numpy as np
import pytest

from pipeline.uzha.grid import Grid
from pipeline.uzha.sources.osm import line_length_per_cell


def test_line_length_split_between_cells():
    grid = Grid.from_bbox((69.2, 41.25, 69.21, 41.26), cell_size=200)
    y = grid.top - 100
    line = np.array([[grid.left + 50, y], [grid.left + 350, y]])
    lengths = line_length_per_cell(grid, [line])
    assert lengths[0, 0] == pytest.approx(150, abs=10)
    assert lengths[0, 1] == pytest.approx(150, abs=10)
    assert lengths.sum() == pytest.approx(300)
