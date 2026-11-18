"""One way to fetch a large file: stream it into `<name>.part`, then rename, so a broken download never looks complete."""
import logging
from pathlib import Path

import requests

log = logging.getLogger(__name__)

CHUNK_BYTES = 1 << 20


def download_to(url: str, path: Path, timeout_s: float, label: str | None = None) -> Path:
    """`path`, downloaded from `url` unless it is already there. A failed download leaves no file behind."""
    path = Path(path)
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    log.info("downloading %s", label or url)
    partial = path.with_suffix(path.suffix + ".part")
    try:
        with requests.get(url, stream=True, timeout=timeout_s) as response:
            response.raise_for_status()
            with partial.open("wb") as f:
                for chunk in response.iter_content(CHUNK_BYTES):
                    f.write(chunk)
        partial.replace(path)
    finally:
        partial.unlink(missing_ok=True)
    return path
