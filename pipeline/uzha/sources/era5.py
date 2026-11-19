"""Hourly ERA5 reanalysis at one point, through the Open-Meteo historical weather API (no key needed)."""
import logging
import time

import requests

log = logging.getLogger(__name__)

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
SOURCE_LABEL = "ERA5 (Copernicus) via Open-Meteo"
USER_AGENT = "uzha-heat-pipeline/0.1"
#: Uzbekistan time, UTC+5 all year: daily maxima are taken over local days.
TIMEZONE = "Asia/Tashkent"
VARIABLES = ("temperature_2m", "dew_point_2m", "wind_speed_10m", "shortwave_radiation", "cloud_cover")
TIMEOUT_S = (30, 180)
ATTEMPTS = 3
RETRY_DELAY_S = 20


def hourly(lon: float, lat: float, start: str, end: str, sleep=time.sleep, variables: tuple = VARIABLES,
           model: str = "era5", timezone: str = TIMEZONE) -> dict:
    """Hourly series from `start` to `end` (ISO dates, inclusive), in `timezone` (local time by default).

    Returns {"time": [...], <variable>: [...], "point": [lon, lat] of the ERA5 grid point, "elevation": m}.
    `elevation` is the height Open-Meteo corrected the 2 m temperature to (its DEM at the requested point).
    Wind is in m/s, radiation in W/m² (mean over the preceding hour; `*_instant` variables are instantaneous),
    cloud cover in %. `model` is "era5" or "era5_land" (Open-Meteo model names).
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start,
        "end_date": end,
        "hourly": ",".join(variables),
        "models": model,
        "wind_speed_unit": "ms",
        "timezone": timezone,
    }
    for attempt in range(1, ATTEMPTS + 1):
        try:
            response = requests.get(ARCHIVE_URL, params=params, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT_S)
            response.raise_for_status()
            payload = response.json()
            series = {key: payload["hourly"][key] for key in ("time", *variables)}
            series["point"] = [payload["longitude"], payload["latitude"]]
            series["elevation"] = payload.get("elevation")
            return series
        except (requests.RequestException, ValueError, KeyError) as error:
            log.warning("Open-Meteo attempt %d/%d failed: %s", attempt, ATTEMPTS, error)
            if attempt == ATTEMPTS:
                raise
            sleep(RETRY_DELAY_S * attempt)
