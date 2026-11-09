import json

import numpy as np
from shapely.geometry import box

from pipeline.uzha import export
from pipeline.uzha.cities import CITIES
from pipeline.uzha.features import FACTORS

CITY_KEYS = {"id", "name", "nameEn", "country", "center", "bbox", "photo", "lstMean", "r2"}


def _document():
    city = CITIES["tashkent"]
    keys = ["ndvi", "built"]
    lst = np.array([40.12345, 45.5, 50.0])
    values = {"ndvi": [0.1234567, 0.3, 0.5], "built": [80.0, 50.0, 10.0]}
    shap = {"ndvi": [1.23456, 0.0, -2.0], "built": [0.5, 0.1, -0.3]}
    entry = export.city_entry(city, {"url": "https://example.org/a.jpg", "credit": "c"}, lst.mean(), 0.7777)
    importance = [{"key": "ndvi", "meanAbsShap": 1.0782, "correlation": -0.91234},
                  {"key": "built", "meanAbsShap": 0.3, "correlation": 0.8}]
    district = export.district_entry("Район", box(69.2, 41.2, 69.3, 41.3), lst[:2],
                                     {key: np.asarray(column[:2]) for key, column in shap.items()})
    return export.city_document(
        entry=entry,
        period={"label": "июнь–август 2023–2025", "lstScenes": 9, "s2Scenes": 6},
        grid={"cellSizeM": 200, "halfSizeDeg": [0.0012, 0.0009], "count": 3},
        features=export.feature_descriptions(keys, FACTORS),
        model={"type": "XGBoost", "r2Cv": 0.778, "maeCv": 1.1, "cv": "spatial block 5-fold", "baseValue": 44.2},
        stats=export.lst_stats(lst),
        importance=importance,
        cells=export.cells_block([69.123456789] * 3, [41.2] * 3, lst, values, shap),
        districts=[district],
    )


def test_document_matches_contract_schema():
    doc = _document()
    assert set(doc) == {"city", "period", "grid", "features", "model", "stats", "globalImportance", "cells",
                        "districts"}
    assert set(doc["city"]) == CITY_KEYS
    assert set(doc["stats"]) == {"lstMean", "lstMin", "lstMax", "lstP10", "lstP90"}
    assert set(doc["cells"]) == {"lon", "lat", "lst", "values", "shap"}
    feature_keys = [feature["key"] for feature in doc["features"]]
    assert set(doc["cells"]["values"]) == set(feature_keys) == set(doc["cells"]["shap"])
    count = doc["grid"]["count"]
    columns = [doc["cells"]["lon"], doc["cells"]["lat"], doc["cells"]["lst"],
               *doc["cells"]["values"].values(), *doc["cells"]["shap"].values()]
    assert all(len(column) == count for column in columns)
    district = doc["districts"][0]
    assert district["geometry"]["type"] == "Polygon"
    assert district["cellCount"] == 2 and set(district["shapMean"]) == set(feature_keys)


def test_values_rounded_to_three_decimals_and_coords_to_five():
    doc = _document()
    assert doc["cells"]["values"]["ndvi"][0] == 0.123
    assert doc["cells"]["shap"]["ndvi"][0] == 1.235
    assert doc["cells"]["lst"][0] == 40.123
    assert doc["cells"]["lon"][0] == 69.12346
    assert doc["globalImportance"][0] == {"key": "ndvi", "meanAbsShap": 1.078, "correlation": -0.912}
    assert doc["city"]["r2"] == 0.778


def test_districts_omitted_when_empty():
    doc = _document()
    without = export.city_document(**{**_kwargs_from(doc), "districts": []})
    assert "districts" not in without


def test_write_json_and_cities_index_roundtrip(tmp_path):
    doc = _document()
    export.write_json(tmp_path / "tashkent.json", doc)
    assert json.loads((tmp_path / "tashkent.json").read_text(encoding="utf-8"))["city"]["name"] == "Ташкент"
    bukhara = dict(doc["city"], id="bukhara")
    export.update_cities_index(tmp_path / "cities.json", bukhara, list(CITIES))
    index = export.update_cities_index(tmp_path / "cities.json", doc["city"], list(CITIES))
    assert [entry["id"] for entry in index] == ["tashkent", "bukhara"]
    assert json.loads((tmp_path / "cities.json").read_text(encoding="utf-8")) == index


def _kwargs_from(doc):
    return {"entry": doc["city"], "period": doc["period"], "grid": doc["grid"], "features": doc["features"],
            "model": doc["model"], "stats": doc["stats"], "importance": doc["globalImportance"],
            "cells": doc["cells"], "districts": doc.get("districts", [])}


def test_city_entry_uses_analysed_bbox():
    from pipeline.uzha.cities import get_city
    city = get_city("tashkent")
    entry = export.city_entry(city, None, 44.0, 0.7, bbox=(69.1039123456, 41.1, 69.54, 41.44))
    assert entry["bbox"] == [69.10391, 41.1, 69.54, 41.44]
    assert export.city_entry(city, None, 44.0, 0.7)["bbox"] == list(city.bbox)
