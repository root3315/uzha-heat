"""Data handed to us from outside (points or a raster) put on our 200 m cells and compared with our surface temperature.

Pure helpers: no downloads. The cells are the exported centres (lon, lat) with the grid's half size in degrees.
"""
import csv
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds
from scipy.spatial import cKDTree
from scipy.stats import spearmanr

from .validation import agreement, pixel_centers

LON_NAMES = ("lon", "lng", "long", "longitude", "x")
LAT_NAMES = ("lat", "latitude", "y")
KELVIN_ABOVE = 150.0  # a median above this is Kelvin: no surface or air temperature on Earth is 150 °C
# A point belongs to the cell whose centre is nearest, if it lies within this many cell sizes of it on either axis;
# a little over half a cell, since the UTM grid is turned slightly against lon/lat.
MATCH_HALF = 0.6
MIN_PAIRS = 3
MIN_PAIRS_FOR_HOTTEST = 10
METRES_PER_DEGREE = 111_320.0


@dataclass
class Points:
    lon: np.ndarray
    lat: np.ndarray
    value: np.ndarray
    names: list
    value_column: str


def _number(text: str, decimal_comma: bool) -> float:
    text = text.strip().replace(" ", "").replace(" ", "")
    if decimal_comma:
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return math.nan


def read_points_csv(path: Path, value_column: str | None = None) -> Points:
    """Points from a CSV: longitude and latitude columns found by name, the value is the one other numeric column."""
    text = Path(path).read_text(encoding="utf-8-sig")
    dialect = csv.Sniffer().sniff(text.splitlines()[0], delimiters=",;\t")
    rows = list(csv.DictReader(text.splitlines(), dialect=dialect))
    if not rows:
        raise ValueError(f"{path}: no rows")
    columns = list(rows[0].keys())
    by_name = {c.strip().lower(): c for c in columns}
    lon_col = next((by_name[n] for n in LON_NAMES if n in by_name), None)
    lat_col = next((by_name[n] for n in LAT_NAMES if n in by_name), None)
    if lon_col is None or lat_col is None:
        raise ValueError(f"{path}: no longitude/latitude columns among {', '.join(columns)}")
    decimal_comma = dialect.delimiter != ","

    def numeric(column: str) -> np.ndarray:
        return np.array([_number(row[column] or "", decimal_comma) for row in rows])

    others = [c for c in columns if c not in (lon_col, lat_col)]
    numeric_others = [c for c in others if np.isfinite(numeric(c)).any()]
    if value_column is None:
        if len(numeric_others) != 1:
            raise ValueError(f"{path}: say which column to compare (--value), one of: {', '.join(numeric_others)}")
        value_column = numeric_others[0]
    elif value_column not in columns:
        raise ValueError(f"{path}: no column {value_column!r}; columns: {', '.join(columns)}")
    label = next((c for c in others if c not in numeric_others), None)
    names = [row[label].strip() for row in rows] if label else [str(i + 1) for i in range(len(rows))]
    return Points(numeric(lon_col), numeric(lat_col), numeric(value_column), names, value_column)


def cells_for_points(cell_lon: np.ndarray, cell_lat: np.ndarray, half_deg: tuple, lon: np.ndarray,
                     lat: np.ndarray) -> np.ndarray:
    """Index of the cell each point falls in, or -1 when it is outside the grid."""
    scale = np.array([2 * half_deg[0], 2 * half_deg[1]])
    tree = cKDTree(np.column_stack([cell_lon, cell_lat]) / scale)
    distance, index = tree.query(np.column_stack([lon, lat]) / scale, p=np.inf, distance_upper_bound=MATCH_HALF)
    return np.where(np.isfinite(distance), index, -1)


def to_celsius(values: np.ndarray) -> tuple:
    """(values in °C, whether they were Kelvin)."""
    values = np.asarray(values, float)
    if np.isfinite(values).any() and np.nanmedian(values) > KELVIN_ABOVE:
        return values - 273.15, True
    return values, False


def raster_to_cells(path: Path, cell_lon: np.ndarray, cell_lat: np.ndarray, half_deg: tuple, band: int = 1,
                    with_pixels: bool = False):
    """The raster's value for each cell: the mean of its pixels when they are finer than a cell, else the pixel
    under the cell centre. Any CRS; nodata and pixels outside the raster are NaN.

    With `with_pixels`, returns (values, pixel): for a raster coarser than a cell, `pixel` is the index of the
    pixel under each cell centre (-1 outside), so the cells can be averaged up to it; for a finer one, None."""
    lat0 = float(np.mean(cell_lat))
    cell_m = 2 * half_deg[1] * METRES_PER_DEGREE
    with rasterio.open(path) as src:
        to_raster = Transformer.from_crs("EPSG:4326", src.crs, always_xy=True)
        pixel_m = max(abs(src.res[0]), abs(src.res[1]))
        if src.crs.is_geographic:
            pixel_m *= METRES_PER_DEGREE * math.cos(math.radians(lat0))
        margin = 2 * max(half_deg)
        left, bottom, right, top = transform_bounds("EPSG:4326", src.crs, cell_lon.min() - margin, cell_lat.min() - margin,
                                                    cell_lon.max() + margin, cell_lat.max() + margin)
        window = from_bounds(left, bottom, right, top, src.transform).round_offsets().round_lengths()
        window = window.intersection(rasterio.windows.Window(0, 0, src.width, src.height))
        data = src.read(band, window=window, masked=True).astype(float).filled(np.nan)
        transform = src.window_transform(window)
        crs = src.crs

    if pixel_m <= cell_m:
        x, y = pixel_centers(transform, data.shape)
        lon, lat = Transformer.from_crs(crs, "EPSG:4326", always_xy=True).transform(x.ravel(), y.ravel())
        cell = cells_for_points(cell_lon, cell_lat, half_deg, np.asarray(lon), np.asarray(lat))
        values = data.ravel()
        keep = (cell >= 0) & np.isfinite(values)
        total = np.bincount(cell[keep], weights=values[keep], minlength=len(cell_lon))
        count = np.bincount(cell[keep], minlength=len(cell_lon))
        with np.errstate(invalid="ignore", divide="ignore"):
            values = np.where(count > 0, total / count, np.nan)
        return (values, None) if with_pixels else values

    x, y = to_raster.transform(cell_lon, cell_lat)
    cols, rows = ~transform * (np.asarray(x), np.asarray(y))
    row, col = np.floor(rows).astype(int), np.floor(cols).astype(int)
    inside = (row >= 0) & (row < data.shape[0]) & (col >= 0) & (col < data.shape[1])
    out = np.full(len(cell_lon), np.nan)
    out[inside] = data[row[inside], col[inside]]
    if not with_pixels:
        return out
    pixel = np.where(inside & np.isfinite(out), row * data.shape[1] + col, -1)
    return out, pixel


def compare_by_pixel(ours: np.ndarray, theirs: np.ndarray, pixel: np.ndarray) -> dict:
    """`compare` at the coarser raster's own resolution: our cells averaged within each of its pixels."""
    keep = (pixel >= 0) & np.isfinite(ours) & np.isfinite(theirs)
    ids, group = np.unique(pixel[keep], return_inverse=True)
    count = np.bincount(group)
    mean_ours = np.bincount(group, weights=ours[keep]) / count
    mean_theirs = np.bincount(group, weights=theirs[keep]) / count
    return compare(mean_ours, mean_theirs)


def compare(ours: np.ndarray, theirs: np.ndarray) -> dict:
    """Agreement (n, Pearson r, bias ours − theirs, RMSE), Spearman ρ, and the share of our hottest tenth of the
    matched cells that is also in theirs: whether we find the heat in the same places."""
    ours, theirs = np.asarray(ours, float), np.asarray(theirs, float)
    both = np.isfinite(ours) & np.isfinite(theirs)
    report = agreement(ours[both], theirs[both])
    a, b = ours[both], theirs[both]
    report["spearman"] = float(spearmanr(a, b).statistic) if len(a) >= MIN_PAIRS else None
    if len(a) >= MIN_PAIRS_FOR_HOTTEST:
        k = max(1, len(a) // 10)
        top_ours, top_theirs = set(np.argsort(-a)[:k]), set(np.argsort(-b)[:k])
        report["hottestTenthOverlap"] = len(top_ours & top_theirs) / k
    else:
        report["hottestTenthOverlap"] = None
    return report
