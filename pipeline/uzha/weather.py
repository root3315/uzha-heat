"""Summer weather at the city centre: ERA5 reanalysis, for the whole summer and at the Landsat overpasses.

A light step over a city JSON that already exists: it adds `city.weather` to `<id>.json` and to the
city's entry in `cities.json`. Weather is one point per city (ERA5 is ~25 km), so it is context for
comparing cities, not a model factor.
"""
import json
import logging
import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .cache import Cache
from .export import write_json
from .sources import era5, landsat

log = logging.getLogger(__name__)

YEARS = (2023, 2024, 2025)
MONTHS = (6, 7, 8)
PERIOD_LABEL = "июнь–август 2023–2025"
#: Uzbekistan is UTC+5 with no daylight saving.
LOCAL_OFFSET = timedelta(hours=5)
DECIMALS = 1

# Magnus formula over water, Alduchov & Eskridge (1996).
MAGNUS_A = 17.625
MAGNUS_B = 243.04


def relative_humidity(t: float, dew_point: float) -> float:
    """Relative humidity, %, from air temperature and dew point at 2 m, °C."""
    ratio = math.exp(MAGNUS_A * dew_point / (MAGNUS_B + dew_point)) / math.exp(MAGNUS_A * t / (MAGNUS_B + t))
    return min(100.0, 100.0 * ratio)


def _mean(values) -> float:
    values = [v for v in values if v is not None]
    return sum(values) / len(values) if values else math.nan


def _r(value: float) -> float:
    return round(value, DECIMALS)


def _is_summer(stamp: str) -> bool:
    return int(stamp[:4]) in YEARS and int(stamp[5:7]) in MONTHS


def summer_summary(series: dict) -> dict:
    """Means over every June–August hour, the mean daily maximum of air temperature, and the mean daily
    total of solar radiation (kWh/m², from hourly means in W/m²)."""
    hours = [i for i, stamp in enumerate(series["time"]) if _is_summer(stamp)]
    if not hours:
        raise ValueError("no summer hours in the weather series")
    t, td = series["temperature_2m"], series["dew_point_2m"]
    daily_max, daily_solar = defaultdict(lambda: -math.inf), defaultdict(float)
    for i in hours:
        day = series["time"][i][:10]
        if t[i] is not None:
            daily_max[day] = max(daily_max[day], t[i])
        daily_solar[day] += series["shortwave_radiation"][i] or 0.0
    return {
        "windMs": _r(_mean(series["wind_speed_10m"][i] for i in hours)),
        "humidityPct": _r(_mean(relative_humidity(t[i], td[i]) for i in hours if t[i] is not None and td[i] is not None)),
        "solarKwhM2": _r(_mean(daily_solar.values()) / 1000.0),
        "cloudPct": _r(_mean(series["cloud_cover"][i] for i in hours)),
        "airMeanC": _r(_mean(t[i] for i in hours)),
        "airMaxC": _r(_mean(daily_max.values())),
    }


def local_hour(moment: datetime) -> str:
    """The Open-Meteo local-time stamp nearest to a UTC moment (naive means UTC): "2024-07-03T11:00"."""
    utc = moment.astimezone(timezone.utc).replace(tzinfo=None) if moment.tzinfo else moment
    local = utc + LOCAL_OFFSET
    rounded = (local + timedelta(minutes=30)).replace(minute=0, second=0, microsecond=0)
    return rounded.strftime("%Y-%m-%dT%H:%M")


def overpass_summary(series: dict, moments: list) -> dict | None:
    """Mean conditions at the hours of the given UTC moments, or None if none of them is in the series.
    Scenes of one overpass (neighbouring Landsat rows) share an hour, so `days` counts distinct overpasses."""
    index = {stamp: i for i, stamp in enumerate(series["time"])}
    hours = sorted({index[s] for s in (local_hour(m) for m in moments) if s in index})
    if not hours:
        return None
    t, td = series["temperature_2m"], series["dew_point_2m"]
    return {
        "days": len(hours),
        "localHour": round(_mean(int(series["time"][i][11:13]) for i in hours)),
        "windMs": _r(_mean(series["wind_speed_10m"][i] for i in hours)),
        "humidityPct": _r(_mean(relative_humidity(t[i], td[i]) for i in hours if t[i] is not None and td[i] is not None)),
        "solarWm2": round(_mean(series["shortwave_radiation"][i] for i in hours)),
        "cloudPct": _r(_mean(series["cloud_cover"][i] for i in hours)),
        "airC": _r(_mean(t[i] for i in hours)),
    }


def landsat_moments(bbox: tuple, period_label: str) -> list:
    """Acquisition times (UTC) of the Landsat scenes the LST median was drawn from: the up-to-30
    lowest-cloud candidates of the period (the pipeline then drops those less than 20 % clear over the city)."""
    period = next((p for p in landsat.PERIODS if p.label == period_label), landsat.PERIODS[0])
    return [item.datetime for item in landsat.find_scenes(bbox, period)]


def fetch_series(lon: float, lat: float) -> dict:
    return era5.hourly(lon, lat, f"{YEARS[0]}-{MONTHS[0]:02d}-01", f"{YEARS[-1]}-{MONTHS[-1]:02d}-31")


def city_weather(series: dict, moments: list) -> dict:
    weather = {
        "source": era5.SOURCE_LABEL,
        "period": PERIOD_LABEL,
        "point": [round(v, 3) for v in series["point"]],
        "summer": summer_summary(series),
    }
    overpass = overpass_summary(series, moments)
    if overpass:
        weather["overpass"] = overpass
    return weather


def enrich(document: dict, cache_root: Path) -> dict:
    """Add `city.weather` to a city document in place; a failed source leaves the document as it was."""
    city = document["city"]
    cache = Cache(Path(cache_root) / "weather")
    try:
        moments = cache.get_or_compute(f"{city['id']}_landsat_times",
                                       lambda: landsat_moments(tuple(city["bbox"]), document["period"]["label"]))
    except Exception:
        log.exception("%s: Landsat scene times unavailable, summer means only", city["id"])
        moments = []
    try:
        lon, lat = city["center"]
        series = cache.get_or_compute(f"{city['id']}_era5", lambda: fetch_series(lon, lat))
        city["weather"] = city_weather(series, moments or [])
    except Exception:
        log.exception("%s: ERA5 unavailable, no weather", city["id"])
    return document


def enrich_file(path: Path, cache_root: Path) -> dict:
    """Run `enrich` on an exported city JSON, write it back and copy the weather into cities.json."""
    path = Path(path)
    document = enrich(json.loads(path.read_text(encoding="utf-8")), cache_root)
    write_json(path, document)
    copy_to_index(path.parent / "cities.json", document["city"])
    return document


def copy_to_index(index_path: Path, city: dict) -> None:
    """Put the city's `weather` on its entry in cities.json, if both exist."""
    if "weather" not in city or not index_path.exists():
        return
    entries = json.loads(index_path.read_text(encoding="utf-8"))
    for entry in entries:
        if entry["id"] == city["id"]:
            entry["weather"] = city["weather"]
    write_json(index_path, entries)
