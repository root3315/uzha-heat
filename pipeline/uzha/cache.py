"""Pickle cache for expensive downloads, one file per layer under pipeline/cache/<city>_<grid>/.

A None result (failed download) is not cached, so the next run retries it.
"""
import logging
import pickle
from pathlib import Path

log = logging.getLogger(__name__)


class Cache:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def get_or_compute(self, name: str, compute):
        path = self.root / f"{name}.pkl"
        if path.exists():
            log.info("cache hit: %s", path.name)
            with path.open("rb") as f:
                return pickle.load(f)
        value = compute()
        if value is None:
            return None
        with path.open("wb") as f:
            pickle.dump(value, f, protocol=pickle.HIGHEST_PROTOCOL)
        return value
