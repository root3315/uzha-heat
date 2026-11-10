import json
from datetime import datetime, timezone

import pytest

from pipeline.uzha import weather


def _series(days=("2024-07-01", "2024-07-02"), extra_days=("2024-05-01",)):
    """Two summer days and one spring day: hours 00..23 local, temperature rising to a peak of 20 + day."""
    series = {key: [] for key in ("time", "temperature_2m", "dew_point_2m", "wind_speed_10m", "shortwave_radiation", "cloud_cover")}
    for n, day in enumerate((*days, *extra_days)):
        spring = day in extra_days
        for hour in range(24):
            series["time"].append(f"{day}T{hour:02d}:00")
            series["temperature_2m"].append(-50.0 if spring else 10.0 + hour * (10.0 + n) / 23)
            series["dew_point_2m"].append(0.0)
            series["wind_speed_10m"].append(99.0 if spring else 2.0 + n)
            series["shortwave_radiation"].append(0.0 if spring or hour < 6 or hour > 18 else 500.0)
            series["cloud_cover"].append(10.0)
    series["point"] = [69.25, 41.25]
    return series


def test_relative_humidity_from_dew_point():
    assert weather.relative_humidity(20.0, 20.0) == pytest.approx(100.0)
    # 30 °C air with a 10 °C dew point is about 29 % (standard psychrometric tables).
    assert weather.relative_humidity(30.0, 10.0) == pytest.approx(28.7, abs=0.5)


def test_summer_summary_skips_other_months_and_takes_daily_max():
    summary = weather.summer_summary(_series())
    assert summary["windMs"] == pytest.approx(2.5)
    assert summary["airMaxC"] == pytest.approx(20.5)  # mean of 20 and 21
    assert summary["solarKwhM2"] == pytest.approx(13 * 500 / 1000)
    assert summary["cloudPct"] == 10.0
    assert 0 < summary["humidityPct"] < 100


def test_local_hour_rounds_utc_to_uzbek_time():
    assert weather.local_hour(datetime(2024, 7, 1, 5, 52, tzinfo=timezone.utc)) == "2024-07-01T11:00"
    assert weather.local_hour(datetime(2024, 7, 1, 5, 20)) == "2024-07-01T10:00"


def test_overpass_summary_matches_scene_hours():
    moments = [datetime(2024, 7, 1, 6, 0, tzinfo=timezone.utc), datetime(2024, 7, 2, 6, 0, tzinfo=timezone.utc),
               datetime(2022, 7, 2, 6, 0, tzinfo=timezone.utc)]  # the last one is outside the series
    overpass = weather.overpass_summary(_series(), moments)
    assert overpass["days"] == 2
    assert overpass["localHour"] == 11
    assert overpass["windMs"] == pytest.approx(2.5)
    assert overpass["solarWm2"] == 500


def test_overpass_summary_without_matches_is_none():
    assert weather.overpass_summary(_series(), []) is None


def test_enrich_file_writes_weather_to_the_city_and_the_index(tmp_path, monkeypatch):
    monkeypatch.setattr(weather, "fetch_series", lambda lon, lat: _series())
    monkeypatch.setattr(weather, "landsat_moments", lambda bbox, label: [datetime(2024, 7, 1, 6, tzinfo=timezone.utc)])
    city = {"id": "tashkent", "center": [69.28, 41.31], "bbox": [69.1, 41.1, 69.5, 41.4]}
    path = tmp_path / "tashkent.json"
    path.write_text(json.dumps({"city": city, "period": {"label": weather.PERIOD_LABEL}}), encoding="utf-8")
    (tmp_path / "cities.json").write_text(json.dumps([city, {"id": "bukhara"}]), encoding="utf-8")

    weather.enrich_file(path, tmp_path / "cache")

    written = json.loads(path.read_text(encoding="utf-8"))["city"]["weather"]
    assert written["source"] == "ERA5 (Copernicus) via Open-Meteo"
    assert written["point"] == [69.25, 41.25]
    assert written["overpass"]["days"] == 1
    index = json.loads((tmp_path / "cities.json").read_text(encoding="utf-8"))
    assert index[0]["weather"] == written
    assert "weather" not in index[1]


def test_enrich_survives_a_failed_source(tmp_path, monkeypatch):
    def fail(*_):
        raise OSError("offline")

    monkeypatch.setattr(weather, "fetch_series", fail)
    monkeypatch.setattr(weather, "landsat_moments", fail)
    document = {"city": {"id": "x", "center": [0, 0], "bbox": [0, 0, 1, 1]}, "period": {"label": ""}}
    assert "weather" not in weather.enrich(document, tmp_path)["city"]
