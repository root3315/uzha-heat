"""The summer night surface temperature from MODIS Aqua as the site draws it: the native 1 km pixels, not resampled.

The grid stays on the MODIS sinusoidal projection, so every pixel the site draws is a real MODIS pixel. A pixel's
corners in lon/lat: lat = y / R, lon = x / (R cos lat), in radians (spherical sinusoidal, R = `radiusM`).
"""
import math

import numpy as np

from .sources import modis

FORMAT = "uzha-night-1"
PLATFORM = "aqua"


def _round(value: float, digits: int = 1):
    return None if not math.isfinite(value) else round(float(value), digits)


def lon_lat(x: float, y: float, radius: float = modis.SPHERE_RADIUS_M) -> tuple:
    """A point of the sinusoidal grid in degrees."""
    lat = y / radius
    return math.degrees(x / (radius * math.cos(lat))), math.degrees(lat)


def lonlat_bounds(x0: float, y0: float, pixel: float, shape: tuple) -> list:
    """[west, south, east, north] of the grid's corners in degrees (the widest of its rows)."""
    rows, cols = shape
    corners = [lon_lat(x0 + c * pixel, y0 - r * pixel) for r in (0, rows) for c in (0, cols)]
    lons, lats = [p[0] for p in corners], [p[1] for p in corners]
    return [round(min(lons), 5), round(min(lats), 5), round(max(lons), 5), round(max(lats), 5)]


def pixel_centres_lonlat(x0: float, y0: float, pixel: float, shape: tuple) -> tuple:
    """Lon and lat (degrees) of every pixel centre, as (rows, cols) arrays."""
    rows, cols = shape
    x = x0 + (np.arange(cols) + 0.5) * pixel
    y = y0 - (np.arange(rows) + 0.5) * pixel
    lat = y / modis.SPHERE_RADIUS_M
    lon = x[None, :] / (modis.SPHERE_RADIUS_M * np.cos(lat)[:, None])
    return np.degrees(lon), np.degrees(np.broadcast_to(lat[:, None], (rows, cols)))


def keep_within(night: np.ndarray, x0: float, y0: float, pixel: float, bbox_lonlat: tuple) -> np.ndarray:
    """The night values with every pixel whose centre falls outside the lon/lat box set to NaN.

    At these longitudes the sinusoidal box around the city is a strongly sheared parallelogram in lon/lat, reaching
    tens of kilometres past the city into the mountains; only the area around the city is worth drawing.
    """
    lon, lat = pixel_centres_lonlat(x0, y0, pixel, night.shape)
    west, south, east, north = bbox_lonlat
    inside = (lon >= west) & (lon <= east) & (lat >= south) & (lat <= north)
    return np.where(inside, night, np.nan)


def night_document(product: modis.ModisLst, period_label: str, bbox_lonlat: tuple) -> dict:
    """The web file: grid origin and pixel size in sinusoidal metres, row-major °C (1 decimal, null for no data).

    Only pixels whose centre lies in `bbox_lonlat` (the city with its surroundings) carry a value.
    """
    transform = product.raster.transform
    night = keep_within(np.asarray(product.night, dtype=float), transform.c, transform.f, transform.a, bbox_lonlat)
    rows, cols = night.shape
    finite = night[np.isfinite(night)]
    if finite.size == 0:
        raise ValueError("no MODIS night pixel with enough good composites")
    return {
        "format": FORMAT,
        "product": modis.PLATFORMS[PLATFORM],
        "band": modis.BANDS["night"][0],
        "overpassLocal": modis.OVERPASS_LOCAL[PLATFORM]["night"],
        "period": period_label,
        "composites": int(product.composites),
        "minComposites": modis.MIN_COMPOSITES,
        "grid": {
            "projection": "sinusoidal",
            "radiusM": modis.SPHERE_RADIUS_M,
            "x0": round(float(transform.c), 3),
            "y0": round(float(transform.f), 3),
            "pixelM": round(float(transform.a), 6),
            "nx": int(cols),
            "ny": int(rows),
        },
        "bounds": lonlat_bounds(transform.c, transform.f, transform.a, (rows, cols)),
        "stats": {"min": _round(finite.min()), "median": _round(float(np.median(finite))), "max": _round(finite.max())},
        "values": [_round(v) for v in night.ravel()],
    }
