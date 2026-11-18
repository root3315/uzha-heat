"""Building footprints for the 3D view: OSM outlines, gaps filled from Microsoft's ML footprints, and export.

OSM comes first: it carries the building type and, sometimes, the height. Microsoft's footprints (traced by a
model on satellite imagery) fill the neighbourhoods OSM has not drawn yet, so only those that do not already
overlap an OSM building are added.
"""
import numpy as np
import pyogrio
import shapely
from pyproj import Transformer

from .grid import WGS84

#: An MS footprint that shares more than this part of its area with OSM buildings is the same building.
MAX_SHARED = 0.1
#: Smaller polygons are sheds, kiosks or tracing noise; invisible in 3D anyway.
MIN_AREA_M2 = 6.0
SIMPLIFY_M = 0.4
#: Heights are drawn to the half metre and confidence to the hundredth: finer would only grow the file.
HEIGHT_STEP_M = 0.5
CONFIDENCE_DECIMALS = 2
SOURCE_TAGGED = 0
SOURCE_MODEL = 1


def to_crs(geometry: np.ndarray, src, dst) -> np.ndarray:
    """Reproject an array of geometries in one pyproj call (one call per polygon would take minutes)."""
    if len(geometry) == 0:
        return geometry
    transformer = Transformer.from_crs(src, dst, always_xy=True)
    coords = shapely.get_coordinates(geometry)
    x, y = transformer.transform(coords[:, 0], coords[:, 1])
    return shapely.set_coordinates(geometry.copy(), np.column_stack([x, y]))


def polygons(geometry: np.ndarray) -> tuple:
    """(valid single polygons, index of the input geometry each came from); multipolygons are split into parts."""
    valid = shapely.make_valid(geometry)
    parts, index = shapely.get_parts(valid, return_index=True)
    keep = shapely.get_type_id(parts) == shapely.GeometryType.POLYGON
    return parts[keep], index[keep]


def without_overlap(extra: np.ndarray, base: np.ndarray, max_shared: float = MAX_SHARED) -> np.ndarray:
    """Mask of `extra` polygons sharing at most `max_shared` of their area with the `base` polygons."""
    keep = np.ones(len(extra), dtype=bool)
    if len(extra) == 0 or len(base) == 0:
        return keep
    pairs = shapely.STRtree(base).query(extra, predicate="intersects")
    if pairs.shape[1] == 0:
        return keep
    # Reprojecting can leave a valid lon/lat outline with a self-touching ring in metres; GEOS refuses to
    # intersect those, so the overlap is measured on repaired copies.
    a, b = shapely.make_valid(extra[pairs[0]]), shapely.make_valid(base[pairs[1]])
    shared = np.zeros(len(extra))
    np.add.at(shared, pairs[0], shapely.area(shapely.intersection(a, b)))
    with np.errstate(divide="ignore", invalid="ignore"):
        keep = shared <= max_shared * shapely.area(extra)
    return keep


def inside(geometry: np.ndarray, area) -> np.ndarray:
    """Mask of polygons whose centroid lies in `area` (all, when there is none)."""
    if area is None:
        return np.ones(len(geometry), dtype=bool)
    centroids = shapely.centroid(geometry)
    return shapely.contains_xy(area, shapely.get_x(centroids), shapely.get_y(centroids))


def simplify(metric: np.ndarray, tolerance: float = SIMPLIFY_M) -> np.ndarray:
    """Drop vertices that move the outline by less than `tolerance` m; a polygon that would collapse stays as is."""
    simple = shapely.simplify(metric, tolerance, preserve_topology=True)
    broken = shapely.is_empty(simple) | ~shapely.is_valid(simple)
    return np.where(broken, metric, simple)


def rounded_height(height: np.ndarray) -> np.ndarray:
    return (np.round(np.asarray(height) / HEIGHT_STEP_M) * HEIGHT_STEP_M).astype(np.float32)


def write_fgb(path, geometry_lonlat: np.ndarray, height: np.ndarray, confidence: np.ndarray, tagged: np.ndarray):
    """FlatGeobuf with a packed R-tree, so the browser can read one view's buildings by HTTP range requests."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.unlink(missing_ok=True)
    pyogrio.raw.write(
        path,
        shapely.to_wkb(geometry_lonlat),
        field_data=[
            rounded_height(height),
            np.round(confidence, CONFIDENCE_DECIMALS).astype(np.float32),
            np.where(tagged, SOURCE_TAGGED, SOURCE_MODEL).astype(np.int16),
        ],
        fields=["h", "conf", "src"],
        geometry_type="Polygon",
        crs=WGS84.to_string(),
        driver="FlatGeobuf",
        layer_options={"SPATIAL_INDEX": "YES"},
    )
