import json

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


class _Response:
    def __init__(self, payload=None, error=None, chunks=None):
        self.payload, self.error, self.chunks = payload, error, chunks

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def raise_for_status(self):
        if self.error:
            raise self.error

    def iter_content(self, size):
        if self.chunks is not None:
            yield from self.chunks
        else:
            yield json.dumps(self.payload).encode()


def test_overpass_cycles_mirrors_with_backoff(monkeypatch):
    from pipeline.uzha.sources import osm
    calls, waits = [], []
    responses = iter([
        _Response(error=osm.requests.HTTPError("504")),
        _Response({"remark": "runtime error: Query timed out", "elements": []}),
        _Response({"elements": [{"id": 1}]}),
    ])

    def fake_post(url, data, headers, timeout, stream):
        calls.append((url, headers["User-Agent"]))
        return next(responses)

    monkeypatch.setattr(osm.requests, "post", fake_post)
    assert osm.overpass("node(1);out;", sleep=waits.append) == [{"id": 1}]
    assert [url for url, _ in calls] == list(osm.OVERPASS_URLS)
    assert all(agent == "uzha-heat-pipeline/0.1" for _, agent in calls)
    assert waits == [osm.retry_delay(1), osm.retry_delay(2)] and waits[1] > waits[0]


def test_overpass_gives_up_after_all_rounds(monkeypatch):
    from pipeline.uzha.sources import osm
    monkeypatch.setattr(osm.requests, "post",
                        lambda *a, **k: _Response(error=osm.requests.ConnectionError("down")))
    waits = []
    assert osm.overpass("node(1);out;", rounds=2, sleep=waits.append) is None
    assert len(waits) == 2 * len(osm.OVERPASS_URLS) - 1
    assert max(waits) <= osm.RETRY_MAX_DELAY_S


def test_overpass_request_has_wall_clock_cap(monkeypatch):
    from pipeline.uzha.sources import osm
    clock = iter([0.0, 1.0, 500.0])
    monkeypatch.setattr(osm.time, "monotonic", lambda: next(clock))
    monkeypatch.setattr(osm.requests, "post", lambda *a, **k: _Response(chunks=[b"{", b"}"]))
    with pytest.raises(osm.requests.Timeout):
        osm._overpass_once("https://example.org", "node(1);out;", timeout_s=180)
