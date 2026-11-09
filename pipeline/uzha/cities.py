from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class City:
    id: str
    name: str
    name_en: str
    country: str
    center: tuple  # (lon, lat)
    bbox: tuple  # (west, south, east, north), degrees
    wiki_title: str
    osm_relation_id: Optional[int] = None
    district_admin_level: Optional[int] = None


CITIES = {
    "tashkent": City(
        id="tashkent",
        name="Ташкент",
        name_en="Tashkent",
        country="Узбекистан",
        center=(69.2797, 41.3111),
        bbox=(69.12, 41.16, 69.48, 41.43),
        wiki_title="Ташкент",
        osm_relation_id=2216724,
        district_admin_level=6,
    ),
    "samarkand": City(
        id="samarkand",
        name="Самарканд",
        name_en="Samarkand",
        country="Узбекистан",
        center=(66.9750, 39.6542),
        bbox=(66.86, 39.59, 67.07, 39.72),
        wiki_title="Самарканд",
    ),
    "bukhara": City(
        id="bukhara",
        name="Бухара",
        name_en="Bukhara",
        country="Узбекистан",
        center=(64.4286, 39.7747),
        bbox=(64.36, 39.70, 64.54, 39.86),
        wiki_title="Бухара",
    ),
}


def get_city(city_id: str) -> City:
    try:
        return CITIES[city_id]
    except KeyError:
        raise ValueError(f"Unknown city '{city_id}'. Known: {', '.join(CITIES)}") from None
