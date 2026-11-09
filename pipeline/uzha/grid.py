"""Metric analysis grid in the city's UTM zone.

Coarse cells (default 200 m) are the unit of analysis. Rasters are resampled onto a finer
sub-grid that divides each cell into `factor x factor` pixels, then averaged back to cells.
"""
import hashlib
import math
import warnings
from dataclasses import dataclass

import numpy as np
from affine import Affine
from pyproj import Transformer
from rasterio.crs import CRS
from rasterio.warp import transform_bounds

WGS84 = CRS.from_epsg(4326)


def utm_crs_for(lon: float, lat: float) -> CRS:
    zone = int((lon + 180) // 6) + 1
    return CRS.from_epsg((32600 if lat >= 0 else 32700) + zone)


@dataclass(frozen=True)
class Raster:
    """A pixel grid aligned with the analysis grid (a sub-division of it)."""

    crs: CRS
    transform: Affine
    shape: tuple  # (rows, cols)

    @property
    def res(self) -> float:
        return self.transform.a

    @property
    def bounds(self) -> tuple:
        left, top = self.transform.c, self.transform.f
        rows, cols = self.shape
        return left, top - rows * self.res, left + cols * self.res, top


@dataclass(frozen=True)
class Grid:
    crs: CRS
    left: float
    top: float
    rows: int
    cols: int
    cell_size: float

    @classmethod
    def from_bbox(cls, bbox: tuple, cell_size: float = 200.0) -> "Grid":
        west, south, east, north = bbox
        crs = utm_crs_for((west + east) / 2, (south + north) / 2)
        left, bottom, right, top = transform_bounds(WGS84, crs, west, south, east, north, densify_pts=21)
        left = math.floor(left / cell_size) * cell_size
        bottom = math.floor(bottom / cell_size) * cell_size
        right = math.ceil(right / cell_size) * cell_size
        top = math.ceil(top / cell_size) * cell_size
        return cls(
            crs=crs,
            left=left,
            top=top,
            rows=int(round((top - bottom) / cell_size)),
            cols=int(round((right - left) / cell_size)),
            cell_size=cell_size,
        )

    @property
    def shape(self) -> tuple:
        return self.rows, self.cols

    def raster(self, factor: int) -> Raster:
        res = self.cell_size / factor
        return Raster(
            crs=self.crs,
            transform=Affine(res, 0.0, self.left, 0.0, -res, self.top),
            shape=(self.rows * factor, self.cols * factor),
        )

    @property
    def bounds(self) -> tuple:
        return self.left, self.top - self.rows * self.cell_size, self.left + self.cols * self.cell_size, self.top

    def bbox_lonlat(self) -> tuple:
        """The grid's extent in WGS84 (west, south, east, north); used for all data queries."""
        return transform_bounds(self.crs, WGS84, *self.bounds, densify_pts=21)

    def key(self) -> str:
        """Short stable identifier of the grid geometry, used to name cache folders."""
        spec = f"{self.crs.to_epsg()}:{self.left}:{self.top}:{self.rows}:{self.cols}:{self.cell_size}"
        return hashlib.sha1(spec.encode()).hexdigest()[:8]

    def cell_centers(self) -> tuple:
        """UTM x, y of every cell center, each shaped (rows, cols)."""
        xs = self.left + (np.arange(self.cols) + 0.5) * self.cell_size
        ys = self.top - (np.arange(self.rows) + 0.5) * self.cell_size
        return np.meshgrid(xs, ys)

    def cell_centers_lonlat(self) -> tuple:
        x, y = self.cell_centers()
        to_wgs = Transformer.from_crs(self.crs, WGS84, always_xy=True)
        return to_wgs.transform(x, y)

    def cell_index(self, x: np.ndarray, y: np.ndarray) -> tuple:
        """Row/col of the cell containing each UTM point, and a mask of points inside the grid."""
        col = np.floor((np.asarray(x) - self.left) / self.cell_size).astype(int)
        row = np.floor((self.top - np.asarray(y)) / self.cell_size).astype(int)
        inside = (row >= 0) & (row < self.rows) & (col >= 0) & (col < self.cols)
        return row, col, inside

    def sum_points(self, x: np.ndarray, y: np.ndarray, weights=None) -> np.ndarray:
        """Sum of point weights (or point count) per cell."""
        row, col, inside = self.cell_index(x, y)
        w = np.ones(len(row)) if weights is None else np.asarray(weights, dtype=float)
        out = np.zeros(self.shape)
        np.add.at(out, (row[inside], col[inside]), w[inside])
        return out


def aggregate(fine: np.ndarray, factor: int) -> tuple:
    """Average `factor x factor` blocks ignoring NaN; returns (mean, fraction of valid pixels)."""
    rows, cols = fine.shape[0] // factor, fine.shape[1] // factor
    blocks = fine[: rows * factor, : cols * factor].reshape(rows, factor, cols, factor)
    valid = np.isfinite(blocks)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        mean = np.nanmean(blocks, axis=(1, 3))
    return mean, valid.mean(axis=(1, 3))


def half_size_deg(cell_size: float, lat: float) -> list:
    """Half a cell's width/height in degrees at the given latitude, as [lon, lat]."""
    meters_per_deg_lat = 111_320.0
    half = cell_size / 2
    return [half / (meters_per_deg_lat * math.cos(math.radians(lat))), half / meters_per_deg_lat]
