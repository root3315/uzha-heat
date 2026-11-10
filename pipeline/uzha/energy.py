"""Surface energy balance per cell at the Landsat overpass (about 11:00 local time).

A light step over a city JSON that already has `cells.lst`, `cells.values` (ndvi, albedo) and
`city.weather.overpass`: it adds `cells.energy` (W/m², whole numbers) and a top-level `energy`
block with the method, the inputs and the city means. Every coefficient below has its source next to it
and in pipeline/README.md.

    Rn = S_abs + ε·L↓ − ε·σ·Ts⁴          net radiation
    G  = Rn · Γ(Ts, albedo, NDVI)        ground heat flux (SEBAL)
    LE = EF · (Rn − G)                   latent heat (evaporation)
    H  = Rn − G − LE                     sensible heat (heating the air)

so Rn = G + H + LE holds by construction (up to rounding).
"""
import json
import logging
from pathlib import Path

import numpy as np

from .export import write_json

log = logging.getLogger(__name__)

#: Stefan–Boltzmann constant, W m⁻² K⁻⁴.
SIGMA = 5.670374419e-8
KELVIN = 273.15

# Emissivity, NDVI threshold method: Sobrino, Jiménez-Muñoz & Paolini (2004), RSE 90, 434–440,
# https://doi.org/10.1016/j.rse.2004.02.003. Bare soil below NDVI_SOIL, full vegetation above NDVI_VEG,
# a mixture with a cavity term in between. The paper takes the soil value from the red band below 0.2;
# the city JSON has no red band, so a constant soil emissivity is used there.
NDVI_SOIL = 0.2
NDVI_VEG = 0.5
EMISSIVITY_SOIL = 0.97
EMISSIVITY_VEG = 0.99
CAVITY_SHAPE = 0.55  # geometric factor F′ of the cavity term

# Clear-sky emissivity of the air: Brutsaert (1975), Water Resour. Res. 11, 742–744,
# https://doi.org/10.1029/WR011i005p00742. ε_a = 1.24·(e_a/T_a)^(1/7), e_a in hPa, T_a in K.
BRUTSAERT_COEF = 1.24
BRUTSAERT_EXP = 1.0 / 7.0

# Saturation vapour pressure over water, hPa: Magnus form of Alduchov & Eskridge (1996),
# https://doi.org/10.1175/1520-0450(1996)035<0601:IMFAOS>2.0.CO;2 (same constants as weather.py).
MAGNUS_E0 = 6.1094
MAGNUS_A = 17.625
MAGNUS_B = 243.04

# Ground heat flux share, SEBAL: Bastiaanssen (2000), J. Hydrol. 229, 87–100,
# https://doi.org/10.1016/S0022-1694(99)00202-4.
# G/Rn = Ts/α · (0.0038·α + 0.0074·α²) · (1 − 0.98·NDVI⁴), Ts in °C.
SEBAL_G_A = 0.0038
SEBAL_G_B = 0.0074
SEBAL_G_NDVI = 0.98

# Evaporative fraction EF = LE / (Rn − G), interpolated in surface temperature between a hot, dry anchor
# (EF = 0) and a cold, wet anchor (EF = 1) inside the city: S-SEBI, Roerink, Su & Menenti (2000),
# Phys. Chem. Earth B 25, 147–157, https://doi.org/10.1016/S1464-1909(99)00128-8, and SSEB, Senay et al.
# (2007), Sensors 7, 979–1000, https://doi.org/10.3390/s7060979. Anchors are picked by NDVI as in SEBAL
# (Bastiaanssen et al. 1998, https://doi.org/10.1016/S0022-1694(98)00253-4): the hot one among the least green
# cells, the cold one among the greenest.
ANCHOR_NDVI_SHARE = 0.10   # the 10 % least / most green cells are anchor candidates
ANCHOR_LST_SHARE = 0.05    # of those, the 5 % hottest / coldest are averaged into the anchor

# Thermal properties of urban and natural surfaces, Oke (1987) "Boundary Layer Climates", 2nd ed., Table 2.1
# (Routledge, https://doi.org/10.4324/9780203407219). Heat capacity C in MJ m⁻³ K⁻¹, conductivity k in
# W m⁻¹ K⁻¹, thermal admittance μ = √(k·C) in J m⁻² s⁻½ K⁻¹. Explanatory only: no per-cell storage numbers.
SURFACES = [
    {"key": "asphalt", "label": "Асфальт", "heatCapacity": 1.94, "conductivity": 0.75, "admittance": 1205},
    {"key": "concrete", "label": "Бетон", "heatCapacity": 2.11, "conductivity": 1.51, "admittance": 1785},
    {"key": "dry_soil", "label": "Сухой грунт", "heatCapacity": 1.28, "conductivity": 0.30, "admittance": 620},
    {"key": "wet_soil", "label": "Влажная почва", "heatCapacity": 2.96, "conductivity": 2.20, "admittance": 2550},
]

FLUXES = ("sAbs", "rn", "g", "h", "le")


def emissivity(ndvi: np.ndarray) -> np.ndarray:
    """Surface emissivity from NDVI (Sobrino et al. 2004, threshold method)."""
    ndvi = np.asarray(ndvi, dtype=float)
    pv = np.clip((ndvi - NDVI_SOIL) / (NDVI_VEG - NDVI_SOIL), 0.0, 1.0) ** 2
    cavity = (1.0 - EMISSIVITY_SOIL) * (1.0 - pv) * CAVITY_SHAPE * EMISSIVITY_VEG
    mixed = EMISSIVITY_VEG * pv + EMISSIVITY_SOIL * (1.0 - pv) + cavity
    return np.where(ndvi < NDVI_SOIL, EMISSIVITY_SOIL, np.where(ndvi > NDVI_VEG, EMISSIVITY_VEG, mixed))


def vapour_pressure(air_c: float, humidity_pct: float) -> float:
    """Actual vapour pressure of the air, hPa."""
    saturation = MAGNUS_E0 * np.exp(MAGNUS_A * air_c / (MAGNUS_B + air_c))
    return float(saturation * humidity_pct / 100.0)


def longwave_down(air_c: float, humidity_pct: float) -> float:
    """Clear-sky downwelling longwave radiation, W/m² (Brutsaert 1975)."""
    air_k = air_c + KELVIN
    air_emissivity = BRUTSAERT_COEF * (vapour_pressure(air_c, humidity_pct) / air_k) ** BRUTSAERT_EXP
    return float(air_emissivity * SIGMA * air_k ** 4)


def ground_share(lst_c: np.ndarray, albedo: np.ndarray, ndvi: np.ndarray) -> np.ndarray:
    """G/Rn by the SEBAL relation (Bastiaanssen 2000)."""
    albedo = np.asarray(albedo, dtype=float)
    ndvi = np.clip(np.asarray(ndvi, dtype=float), 0.0, 1.0)
    # Ts/α · (aα + bα²) written without dividing by α.
    share = lst_c * (SEBAL_G_A + SEBAL_G_B * albedo) * (1.0 - SEBAL_G_NDVI * ndvi ** 4)
    return np.clip(share, 0.0, 1.0)


def anchors(lst_c: np.ndarray, ndvi: np.ndarray) -> tuple:
    """(hot, cold) anchor surface temperatures, °C: the mean of the hottest few of the least green cells
    and of the coldest few of the greenest cells."""
    lst_c, ndvi = np.asarray(lst_c, dtype=float), np.asarray(ndvi, dtype=float)
    dry = lst_c[ndvi <= np.quantile(ndvi, ANCHOR_NDVI_SHARE)]
    wet = lst_c[ndvi >= np.quantile(ndvi, 1.0 - ANCHOR_NDVI_SHARE)]
    hot = dry[dry >= np.quantile(dry, 1.0 - ANCHOR_LST_SHARE)].mean()
    cold = wet[wet <= np.quantile(wet, ANCHOR_LST_SHARE)].mean()
    return float(hot), float(cold)


def evaporative_fraction(lst_c: np.ndarray, hot: float, cold: float) -> np.ndarray:
    """EF = (T_hot − Ts) / (T_hot − T_cold), clipped to 0..1."""
    if hot <= cold:
        raise ValueError(f"hot anchor {hot:.1f} °C is not above cold anchor {cold:.1f} °C")
    return np.clip((hot - np.asarray(lst_c, dtype=float)) / (hot - cold), 0.0, 1.0)


def balance(lst_c, albedo, ndvi, solar_wm2: float, air_c: float, humidity_pct: float) -> dict:
    """Every flux per cell, W/m² as floats, plus the scalar inputs the method used."""
    lst_c = np.asarray(lst_c, dtype=float)
    albedo = np.asarray(albedo, dtype=float)
    ndvi = np.asarray(ndvi, dtype=float)
    eps = emissivity(ndvi)
    l_down = longwave_down(air_c, humidity_pct)
    s_abs = (1.0 - albedo) * solar_wm2
    l_up = eps * SIGMA * (lst_c + KELVIN) ** 4
    rn = s_abs + eps * l_down - l_up
    g = rn * ground_share(lst_c, albedo, ndvi)
    hot, cold = anchors(lst_c, ndvi)
    le = evaporative_fraction(lst_c, hot, cold) * (rn - g)
    return {"sAbs": s_abs, "rn": rn, "g": g, "h": rn - g - le, "le": le,
            "lDown": l_down, "hotC": hot, "coldC": cold}


def enrich(document: dict) -> dict:
    """Add `cells.energy` and `energy` to a city document in place. Needs the weather at the overpass."""
    overpass = document["city"].get("weather", {}).get("overpass")
    if overpass is None:
        raise ValueError(f"{document['city']['id']}: no weather at the Landsat overpass, run --only weather first")
    cells = document["cells"]
    fluxes = balance(cells["lst"], cells["values"]["albedo"], cells["values"]["ndvi"],
                     overpass["solarWm2"], overpass["airC"], overpass["humidityPct"])
    rounded = {key: np.rint(fluxes[key]).astype(int) for key in ("sAbs", "rn", "g", "le")}
    rounded["h"] = rounded["rn"] - rounded["g"] - rounded["le"]  # closure holds exactly after rounding
    cells["energy"] = {key: [int(v) for v in rounded[key]] for key in FLUXES}
    document["energy"] = {
        "localHour": overpass["localHour"],
        "solarWm2": overpass["solarWm2"],
        "airC": overpass["airC"],
        "humidityPct": overpass["humidityPct"],
        "longwaveDownWm2": round(fluxes["lDown"]),
        "hotAnchorC": round(fluxes["hotC"], 1),
        "coldAnchorC": round(fluxes["coldC"], 1),
        "mean": {key: round(float(np.mean(fluxes[key]))) for key in FLUXES},
        "surfaces": SURFACES,
    }
    return document


def enrich_file(path: Path) -> dict:
    """Run `enrich` on an exported city JSON and write it back."""
    path = Path(path)
    document = enrich(json.loads(path.read_text(encoding="utf-8")))
    write_json(path, document)
    return document
