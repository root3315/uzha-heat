import pickle

from pipeline.uzha.cache import Cache


def test_cache_computes_once_and_reads_back(tmp_path):
    calls = []
    cache = Cache(tmp_path)
    compute = lambda: calls.append(1) or {"a": 1}
    assert cache.get_or_compute("layer", compute) == {"a": 1}
    assert cache.get_or_compute("layer", compute) == {"a": 1}
    assert len(calls) == 1
    assert not list(tmp_path.glob("*.part"))


def test_cache_does_not_keep_a_failed_download(tmp_path):
    cache = Cache(tmp_path)
    assert cache.get_or_compute("layer", lambda: None) is None
    assert not (tmp_path / "layer.pkl").exists()


def test_cache_fetches_again_over_a_truncated_file(tmp_path):
    (tmp_path / "layer.pkl").write_bytes(pickle.dumps({"a": 1})[:5])
    cache = Cache(tmp_path)
    assert cache.get_or_compute("layer", lambda: {"a": 2}) == {"a": 2}
    assert Cache(tmp_path).get_or_compute("layer", lambda: {"a": 3}) == {"a": 2}
