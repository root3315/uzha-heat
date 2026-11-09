"""City photo from the Russian Wikipedia page summary."""
import logging
from urllib.parse import quote

import requests

log = logging.getLogger(__name__)

SUMMARY_URL = "https://ru.wikipedia.org/api/rest_v1/page/summary/{title}"
USER_AGENT = "uzha-heat-pipeline/0.1"
CREDIT = "Wikipedia / Wikimedia Commons"


def city_photo(title: str):
    """{"url", "credit"} for the page's lead image, or None if unavailable."""
    try:
        response = requests.get(SUMMARY_URL.format(title=quote(title)), headers={"User-Agent": USER_AGENT}, timeout=30)
        response.raise_for_status()
        summary = response.json()
    except (requests.RequestException, ValueError) as error:
        log.warning("Wikipedia summary for %s failed: %s", title, error)
        return None
    image = summary.get("originalimage") or summary.get("thumbnail")
    if not image:
        return None
    return {"url": image["source"], "credit": CREDIT}
