"""Pickle cache for expensive downloads, one file per layer under pipeline/cache/<city>_<grid>/.

A None result (failed download) is not cached, so the next run retries it. A file is written whole or not at all, and
one that cannot be read (a run killed by an older version) is fetched again rather than failing every later run.
The key is the layer and the grid only: after changing how a layer is made, delete its `.pkl`.
"""
import logging
import os
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
            try:
                with path.open("rb") as f:
                    value = pickle.load(f)
                log.info("cache hit: %s", path.name)
                return value
            except (EOFError, pickle.UnpicklingError, AttributeError, ImportError) as error:
                log.warning("cache file %s unreadable (%s), fetching again", path.name, error)
        value = compute()
        if value is None:
            return None
        partial = path.with_suffix(".pkl.part")
        with partial.open("wb") as f:
            pickle.dump(value, f, protocol=pickle.HIGHEST_PROTOCOL)
        os.replace(partial, path)  # a run killed mid-write leaves only the .part, never a truncated .pkl
        return value
