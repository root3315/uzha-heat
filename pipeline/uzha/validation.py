"""Pure helpers for checking our Landsat LST against MODIS: pixel aggregation, rings, agreement, heat island."""
import numpy as np
import shapely
from affine import Affine

HEAT_ISLAND_MIN_SAMPLES = 30  # same threshold as web/src/domain/heatIsland.ts (MIN_CELLS)


def aggregate_to_pixels(x: np.ndarray, y: np.ndarray, values: np.ndarray, transform: Affine,
                        shape: tuple) -> tuple:
    """Mean of point values per coarse pixel (points given in the pixel grid's CRS); NaN values ignored.

    Returns (mean, count): mean is NaN where a pixel got no finite value.
    """
    x, y, values = np.asarray(x, float), np.asarray(y, float), np.asarray(values, float)
    cols, rows = ~transform * (x, y)
    row, col = np.floor(rows).astype(int), np.floor(cols).astype(int)
    keep = (row >= 0) & (row < shape[0]) & (col >= 0) & (col < shape[1]) & np.isfinite(values)
    total = np.zeros(shape)
    count = np.zeros(shape, dtype=int)
    np.add.at(total, (row[keep], col[keep]), values[keep])
    np.add.at(count, (row[keep], col[keep]), 1)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.where(count > 0, total / count, np.nan)
    return mean, count


def pixel_centers(transform: Affine, shape: tuple) -> tuple:
    cols, rows = np.meshgrid(np.arange(shape[1]) + 0.5, np.arange(shape[0]) + 0.5)
    return transform * (cols, rows)


def outline_position(outline, x: np.ndarray, y: np.ndarray) -> tuple:
    """(inside, distance): point inside the outline, and its distance to the outline in CRS units (0 inside)."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    points = shapely.points(x, y)
    return shapely.contains_xy(outline, x, y), shapely.distance(outline, points)


def ring_mask(inside: np.ndarray, distance: np.ndarray, width: float) -> np.ndarray:
    """Points outside the outline but within `width` of it."""
    return ~inside & (distance <= width)


def heat_island(values: np.ndarray, inside: np.ndarray, ring: np.ndarray,
                min_samples: int = HEAT_ISLAND_MIN_SAMPLES):
    """Median inside minus median in the ring (as heatIslandIntensity in the web app); None if a side is small."""
    values = np.asarray(values, float)
    finite = np.isfinite(values)
    within, around = values[inside & finite], values[ring & finite]
    if len(within) < min_samples or len(around) < min_samples:
        return None
    inside_median, outside_median = float(np.median(within)), float(np.median(around))
    return {"inside": inside_median, "outside": outside_median, "intensity": inside_median - outside_median,
            "insideCount": int(len(within)), "outsideCount": int(len(around))}


def agreement(ours: np.ndarray, reference: np.ndarray) -> dict:
    """Pearson r, mean bias (ours − reference), RMSE and n over pixels where both are finite."""
    ours, reference = np.asarray(ours, float).ravel(), np.asarray(reference, float).ravel()
    both = np.isfinite(ours) & np.isfinite(reference)
    a, b = ours[both], reference[both]
    if len(a) < 3:
        return {"n": int(len(a)), "r": None, "bias": None, "rmse": None}
    diff = a - b
    return {"n": int(len(a)), "r": float(np.corrcoef(a, b)[0, 1]), "bias": float(diff.mean()),
            "rmse": float(np.sqrt((diff ** 2).mean()))}
