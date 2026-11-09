"""Write the web data contract (docs/data-contract.md) as JSON."""
import json
from pathlib import Path

import numpy as np
from shapely.geometry import MultiPolygon, mapping

from .cities import City

DECIMALS = 3
COORD_DECIMALS = 5  # 3 decimals of a degree is ~100 m, too coarse for 200 m cells
DISTRICT_SIMPLIFY_DEG = 0.0003


def round_values(values) -> list:
    return np.round(np.asarray(values, dtype=float), DECIMALS).tolist()


def round_coords(values) -> list:
    return np.round(np.asarray(values, dtype=float), COORD_DECIMALS).tolist()


def r3(value: float) -> float:
    return round(float(value), DECIMALS)


def city_entry(city: City, photo, lst_mean: float, r2: float) -> dict:
    return {
        "id": city.id,
        "name": city.name,
        "nameEn": city.name_en,
        "country": city.country,
        "center": list(city.center),
        "bbox": list(city.bbox),
        "photo": photo,
        "lstMean": r3(lst_mean),
        "r2": r3(r2),
    }


def lst_stats(lst: np.ndarray) -> dict:
    return {
        "lstMean": r3(np.mean(lst)),
        "lstMin": r3(np.min(lst)),
        "lstMax": r3(np.max(lst)),
        "lstP10": r3(np.percentile(lst, 10)),
        "lstP90": r3(np.percentile(lst, 90)),
    }


def feature_descriptions(keys: list, catalog: dict) -> list:
    return [{"key": key, "label": catalog[key][0], "unit": catalog[key][1], "description": catalog[key][2]}
            for key in keys]


def cells_block(lon, lat, lst, values: dict, shap: dict) -> dict:
    return {
        "lon": round_coords(lon),
        "lat": round_coords(lat),
        "lst": round_values(lst),
        "values": {key: round_values(column) for key, column in values.items()},
        "shap": {key: round_values(column) for key, column in shap.items()},
    }


def district_entry(name: str, polygon, lst: np.ndarray, shap: dict) -> dict:
    return {
        "name": name,
        "geometry": _polygon_geometry(polygon),
        "lstMean": r3(np.mean(lst)),
        "cellCount": int(len(lst)),
        "shapMean": {key: r3(np.mean(column)) for key, column in shap.items()},
    }


def city_document(entry: dict, period: dict, grid: dict, features: list, model: dict, stats: dict,
                  importance: list, cells: dict, districts: list) -> dict:
    document = {
        "city": entry,
        "period": period,
        "grid": grid,
        "features": features,
        "model": model,
        "stats": stats,
        "globalImportance": [
            {"key": row["key"], "meanAbsShap": r3(row["meanAbsShap"]), "correlation": r3(row["correlation"])}
            for row in importance
        ],
        "cells": cells,
    }
    if districts:
        document["districts"] = districts
    return document


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    path.write_text(text, encoding="utf-8")


def update_cities_index(path: Path, entry: dict, order: list) -> list:
    """Insert or replace `entry` in cities.json, keeping registry order."""
    entries = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    by_id = {e["id"]: e for e in entries}
    by_id[entry["id"]] = entry
    ordered = [by_id[i] for i in order if i in by_id] + [e for i, e in by_id.items() if i not in order]
    write_json(path, ordered)
    return ordered


def _polygon_geometry(polygon) -> dict:
    """GeoJSON Polygon (largest part for multi-part shapes), simplified, 5-decimal coordinates."""
    if isinstance(polygon, MultiPolygon):
        polygon = max(polygon.geoms, key=lambda part: part.area)
    simplified = polygon.simplify(DISTRICT_SIMPLIFY_DEG, preserve_topology=True)
    rings = mapping(simplified)["coordinates"]
    return {"type": "Polygon", "coordinates": [round_coords(ring) for ring in rings]}
