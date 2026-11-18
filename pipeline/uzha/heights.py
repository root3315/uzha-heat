"""Height of every building footprint: from OSM tags where present, else from a model.

The method follows the owner's Soya project: Soviet-era and mahalla housing is typical, so a footprint's
shape carries its number of storeys (a five-storey block is a ~70 × 12 m rectangle, a mahalla house a small
irregular polygon). A gradient-boosting model learns height from shape, the building type, how dense and
how tall the neighbours are, and here also GHSL Built-H at the building (a 90 m satellite estimate).
One model is trained on all cities together with the city as a feature: Samarkand and Bukhara have few
tagged buildings of their own.

Every height carries a confidence: 1 where OSM has it, else lower the wider the model's 10–90 % interval.
"""
import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd
import shapely
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.neighbors import KDTree

log = logging.getLogger(__name__)

#: Typical height by OSM building type; both a model feature and the fallback when no model can be trained.
TYPE_PRIOR_M = {
    "house": 4.0, "detached": 4.0, "residential": 12.0, "apartments": 16.0, "dormitory": 16.0, "hut": 3.0,
    "bungalow": 3.5, "garage": 2.6, "garages": 2.8, "shed": 2.5, "carport": 2.5, "roof": 3.0, "greenhouse": 3.0,
    "retail": 6.0, "commercial": 9.0, "supermarket": 7.0, "kiosk": 3.0, "office": 15.0, "industrial": 9.0,
    "warehouse": 8.0, "manufacture": 9.0, "hangar": 10.0, "school": 9.0, "kindergarten": 6.0, "university": 15.0,
    "college": 12.0, "hospital": 15.0, "civic": 12.0, "government": 15.0, "hotel": 20.0, "mosque": 10.0,
    "church": 12.0, "train_station": 12.0, "stadium": 15.0, "sports_hall": 10.0, "service": 3.0,
    "construction": 9.0, "yes": 6.0,
}
DEFAULT_PRIOR_M = 6.0

SHAPE_FEATURES = ["area", "perimeter", "compactness", "rect_long", "rect_short", "elongation", "n_vertices",
                  "type_prior", "dist_center", "ghsl_h"]
DENSITY_FEATURES = ["neigh_count_100", "neigh_area_mean_100"]
HEIGHT_FEATURES = ["neigh_height_mean_150", "neigh_height_max_150", "neigh_labeled_150"]
FEATURES = SHAPE_FEATURES + DENSITY_FEATURES + HEIGHT_FEATURES + ["city"]

DENSITY_RADIUS_M = 100.0
NEIGHBOUR_RADIUS_M = 150.0
TEST_FRACTION = 0.2
SEED = 42
#: Fewer tagged buildings than this and the model would only learn noise; heights fall back to the type prior.
MIN_LABELED = 500
MIN_HEIGHT_M = 2.0
MAX_HEIGHT_M = 400.0
#: Confidence of a modelled height: 1 − (10–90 % interval) / this width, kept between the two bounds.
CONFIDENCE_BAND_M = 24.0
CONFIDENCE_MIN = 0.12
CONFIDENCE_MAX = 0.85
PRIOR_CONFIDENCE = 0.1
MODEL_PARAMS = dict(max_iter=400, learning_rate=0.06, min_samples_leaf=25, l2_regularization=1.0, random_state=SEED)


@dataclass
class Heights:
    height: np.ndarray  # m
    confidence: np.ndarray  # 0–1
    tagged: np.ndarray  # bool: the height is from OSM tags
    metrics: dict  # held-out errors per city, m


def oriented_sides(metric: np.ndarray, area: np.ndarray) -> tuple:
    """Long and short side of each polygon's minimum rotated rectangle; √area where it degenerates."""
    rects = shapely.oriented_envelope(metric)
    fallback = np.sqrt(np.maximum(area, 1.0))
    long_side, short_side = fallback.copy(), fallback.copy()
    ok = shapely.get_num_coordinates(rects) == 5
    if ok.any():
        coords, index = shapely.get_coordinates(rects[ok], return_index=True)
        pts = coords.reshape(-1, 5, 2)
        e1 = np.linalg.norm(pts[:, 1] - pts[:, 0], axis=1)
        e2 = np.linalg.norm(pts[:, 2] - pts[:, 1], axis=1)
        long_side[ok], short_side[ok] = np.maximum(e1, e2), np.minimum(e1, e2)
    return long_side, short_side


def shape_features(metric: np.ndarray, kinds: np.ndarray, center_xy: tuple, ghsl_h: np.ndarray) -> pd.DataFrame:
    """Per-building features that do not depend on other buildings; `metric` are polygons in metres."""
    area = shapely.area(metric)
    perimeter = shapely.length(metric)
    long_side, short_side = oriented_sides(metric, area)
    centroids = shapely.centroid(metric)
    with np.errstate(divide="ignore", invalid="ignore"):
        compactness = np.where(perimeter > 0, 4 * np.pi * area / perimeter ** 2, 0.0)
        elongation = np.where(short_side > 0, long_side / short_side, 1.0)
    return pd.DataFrame({
        "area": area,
        "perimeter": perimeter,
        "compactness": compactness,
        "rect_long": long_side,
        "rect_short": short_side,
        "elongation": elongation,
        "n_vertices": shapely.get_num_coordinates(metric) - 1,
        "type_prior": type_prior(kinds),
        "dist_center": np.hypot(shapely.get_x(centroids) - center_xy[0], shapely.get_y(centroids) - center_xy[1]),
        "ghsl_h": np.asarray(ghsl_h, dtype=float),
        "x": shapely.get_x(centroids),
        "y": shapely.get_y(centroids),
    })


def type_prior(kinds) -> np.ndarray:
    return np.array([TYPE_PRIOR_M.get(str(kind), DEFAULT_PRIOR_M) for kind in kinds], dtype=float)


def neighbours(x: np.ndarray, y: np.ndarray, radius: float) -> np.ndarray:
    """For each building, the indices of the others whose centre lies within `radius` m (itself excluded)."""
    if len(x) == 0:
        return index_lists([])
    points = np.column_stack([x, y])
    return index_lists([nb[nb != i] for i, nb in enumerate(KDTree(points).query_radius(points, r=radius))])


def index_lists(lists: list) -> np.ndarray:
    """A 1D object array of index arrays; filled item by item, as equal-length lists would make numpy build 2D."""
    out = np.empty(len(lists), dtype=object)
    for i, item in enumerate(lists):
        out[i] = item
    return out


def density_features(near: np.ndarray, area: np.ndarray) -> pd.DataFrame:
    """How many buildings stand around each one and how large they are. The building itself is left out, or a lone
    building's "mean neighbour area" would just repeat its own area."""
    return pd.DataFrame({
        "neigh_count_100": np.array([len(nb) for nb in near], dtype=float),
        "neigh_area_mean_100": np.array([area[nb].mean() if len(nb) else 0.0 for nb in near]),
    })


def neighbour_heights(near: np.ndarray, known: np.ndarray, usable: np.ndarray) -> pd.DataFrame:
    """How tall the neighbours are, from the heights in `usable` only.

    The leak guard: while measuring the error, only training heights may be used here. With all known heights a
    held-out building's own height would sit in its training neighbour's features and the error would look better
    than it is. For the final model all known heights are legitimately available.
    """
    allowed = np.where(usable, known, np.nan)
    mean = np.full(len(near), np.nan)
    top = np.full(len(near), np.nan)
    count = np.zeros(len(near))
    for i, nb in enumerate(near):
        values = allowed[nb.astype(int)]
        values = values[np.isfinite(values)]
        if values.size:
            mean[i], top[i], count[i] = values.mean(), values.max(), values.size
    return pd.DataFrame({"neigh_height_mean_150": mean, "neigh_height_max_150": top, "neigh_labeled_150": count})


def split(labeled: np.ndarray, city: np.ndarray, fraction: float = TEST_FRACTION, seed: int = SEED) -> tuple:
    """Train and held-out indices of the labelled buildings, the same share from every city."""
    index = np.flatnonzero(labeled)
    # Stratifying needs two labelled buildings in every city; a city with one would stop the whole run.
    _, counts = np.unique(city[index], return_counts=True)
    stratify = city[index] if counts.min() >= 2 else None
    return train_test_split(index, test_size=fraction, random_state=seed, stratify=stratify)


def _model(**loss) -> HistGradientBoostingRegressor:
    categorical = [name == "city" for name in FEATURES]
    return HistGradientBoostingRegressor(categorical_features=categorical, **loss, **MODEL_PARAMS)


def _matrix(base: pd.DataFrame, near150: np.ndarray, known: np.ndarray, usable: np.ndarray) -> np.ndarray:
    frame = pd.concat([base.reset_index(drop=True), neighbour_heights(near150, known, usable)], axis=1)
    return frame[FEATURES].to_numpy(dtype=np.float64)


def _ghsl_baseline(base: pd.DataFrame) -> np.ndarray:
    """GHSL alone: its height where it sees buildings, else the type prior."""
    ghsl = base["ghsl_h"].to_numpy()
    return np.where(np.isfinite(ghsl) & (ghsl > 0), ghsl, base["type_prior"].to_numpy())


def evaluate(base: pd.DataFrame, near150: np.ndarray, known: np.ndarray, names: list) -> dict:
    """Held-out mean absolute error per city, m: the model against the type prior and GHSL alone."""
    city = base["city"].to_numpy().astype(int)
    train, test = split(np.isfinite(known), city)
    usable = np.zeros(len(known), dtype=bool)
    usable[train] = True
    x = _matrix(base, near150, known, usable)
    predicted = _model(loss="absolute_error").fit(x[train], known[train]).predict(x[test])
    prior = base["type_prior"].to_numpy()[test]
    ghsl = _ghsl_baseline(base)[test]
    truth = known[test]
    metrics = {}
    for code, name in enumerate(names):
        here = city[test] == code
        if not here.any():
            continue
        mae = lambda guess: round(float(np.mean(np.abs(guess[here] - truth[here]))), 2)  # noqa: E731
        metrics[name] = {"heldOut": int(here.sum()), "maeModel": mae(predicted), "maeTypePrior": mae(prior),
                         "maeGhsl": mae(ghsl)}
    return metrics


def estimate(base: pd.DataFrame, near150: np.ndarray, known: np.ndarray, names: list) -> Heights:
    """Heights for all buildings in `base` (features of every city stacked, `city` = index into `names`)."""
    labeled = np.isfinite(known)
    if labeled.sum() < MIN_LABELED:
        log.warning("only %d tagged buildings, heights from the type prior", labeled.sum())
        height = np.where(labeled, known, base["type_prior"].to_numpy())
        confidence = np.where(labeled, 1.0, PRIOR_CONFIDENCE)
        return Heights(np.clip(height, MIN_HEIGHT_M, MAX_HEIGHT_M), confidence, labeled, {})

    metrics = evaluate(base, near150, known, names)
    x = _matrix(base, near150, known, labeled)
    y = known[labeled]
    predicted = _model(loss="absolute_error").fit(x[labeled], y).predict(x)
    low = _model(loss="quantile", quantile=0.1).fit(x[labeled], y).predict(x)
    high = _model(loss="quantile", quantile=0.9).fit(x[labeled], y).predict(x)
    band = np.maximum(high - low, 0.0)
    height = np.clip(np.where(labeled, known, predicted), MIN_HEIGHT_M, MAX_HEIGHT_M)
    confidence = np.where(labeled, 1.0, np.clip(1.0 - band / CONFIDENCE_BAND_M, CONFIDENCE_MIN, CONFIDENCE_MAX))
    return Heights(height, confidence, labeled, metrics)
