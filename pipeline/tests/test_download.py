import pytest

from pipeline.uzha import download


class _Broken:
    """A response that fails half-way through the body."""

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def raise_for_status(self):
        pass

    def iter_content(self, _size):
        yield b"half"
        raise ConnectionError("dropped")


class _Whole(_Broken):
    def iter_content(self, _size):
        yield b"all of it"


def test_a_broken_download_leaves_no_file(monkeypatch, tmp_path):
    monkeypatch.setattr(download.requests, "get", lambda *a, **k: _Broken())
    target = tmp_path / "x.bin"
    with pytest.raises(ConnectionError):
        download.download_to("https://example.invalid/x", target, 1)
    assert list(tmp_path.iterdir()) == []


def test_a_finished_download_is_kept_and_not_fetched_again(monkeypatch, tmp_path):
    monkeypatch.setattr(download.requests, "get", lambda *a, **k: _Whole())
    target = tmp_path / "x.bin"
    assert download.download_to("https://example.invalid/x", target, 1).read_bytes() == b"all of it"
    monkeypatch.setattr(download.requests, "get", lambda *a, **k: pytest.fail("fetched twice"))
    assert download.download_to("https://example.invalid/x", target, 1) == target
