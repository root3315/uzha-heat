"""Flux parameterisations of the per-tile surface energy balance (docs/theory.pdf, sections 3–8).

Everything that does not depend on the surface temperature is computed once in `prepare`, broadcast to (n, T).
`fluxes` then evaluates every term of the residual F_k(T_k) = Rn + QF − H − LE − ΔQS (Eq. 5) for a trial
temperature array, which is all the root finder in `solve.py` needs.

Stated assumptions (each is a modelling choice, not a law):
- Canyon walls radiate as black bodies at air temperature, so a canyon-floor tile sees
  L↓_tile = SVF·L↓ + (1 − SVF)·σ·Ta⁴.
- The shaded share of a tile receives only the diffuse part of K↓ (Eq. 30); diffuse light is not reduced by the
  sky-view factor.
- Heat and water vapour share one aerodynamic resistance; it is computed per tile from the cell's z0m and zd,
  only z0h differs between tiles.
- dRn/dt in the OHM hysteresis term is approximated by (1 − α)·s·dK↓/dt, s the tile's sunlit-plus-diffuse
  share of K↓ (longwave changes slowly around the overpass, diffuse fraction held constant).
- Params.d_t_air shifts the air temperature only; vapour pressure and L↓ are kept as given.
- Water tiles take Params.kb_inv like the sealed surfaces (smooth surface under the cell's bluff-body roughness);
  only trees and grass take kB⁻¹ = ln 10.
- The grass tile of a rural cell is the ring's crop land and takes Params.rs_min_crop.
- Stable stratification uses the long-tailed Beljaars–Holtslag functions instead of Dyer's linear ψ = −5ζ
  (reason next to the constants below); unstable stays Businger–Dyer/Paulson.
- LE keeps its sign: a surface below the dew point of the air condenses through the same resistances.
- Surface resistances do not depend on surface temperature: the vapour pressure deficit in the Jarvis factor is the
  air's, e_s(Ta) − e_a, as in ECMWF's TESSEL (Da = e_sat(T_L) − e_L at the lowest model level).
"""
from dataclasses import dataclass

import numpy as np

from .types import (CANYON_FLOOR, CP_AIR, IMPERVIOUS, KELVIN, LV, RD, SIGMA, TILE, TILES, VEGETATED, VON_KARMAN,
                    Forcing, Params, SebInputs)

GRAVITY = 9.80665  # m s⁻²
EPS_WATER = 0.622  # ratio of the gas constants of dry air and water vapour (Eq. 29)

# Saturation vapour pressure, kPa, T in °C (Eq. 27): Tetens form as in FAO-56, Allen et al. (1998), Eq. 11,
# https://www.fao.org/4/x0490e/x0490e07.htm.
TETENS_E0 = 0.6108
TETENS_A = 17.27
TETENS_B = 237.3

# Monin–Obukhov stability functions. Unstable: Businger–Dyer gradient functions φm = (1 − 16ζ)^(−1/4),
# φh = (1 − 16ζ)^(−1/2) (Dyer 1974, Boundary-Layer Meteorol. 7, 363–372, https://doi.org/10.1007/BF00240838),
# integrated by Paulson (1970), J. Appl. Meteorol. 9, 857–861; the same pair is used in ECMWF IFS Cy47r1 Part IV,
# Eq. 3.19–3.20 (https://www.ecmwf.int/sites/default/files/elibrary/2020/
# 81189-ifs-documentation-cy47r1-part-iv-physical-processes_1.pdf, "IFS Cy47r1 Part IV" below).
# Stable: Holtslag & de Bruin (1988), J. Appl. Meteorol. 27, 689–704, in the form of Beljaars & Holtslag (1991),
# J. Appl. Meteorol. 30, 327–341, https://doi.org/10.1175/1520-0450(1991)030<0327:FPOLSF>2.0.CO;2,
# a = 1, b = 2/3, c = 5, d = 0.35 (IFS Cy47r1 Part IV Eq. 3.22). Dyer's linear stable form ψ = −5ζ has a critical
# bulk Richardson number near 0.2, beyond which a tile decouples from the air completely; at a 40 m blending height
# a water or irrigated tile 1 K below the air reaches it at 2 m s⁻¹, so roots piled up on that edge.
# The long-tailed form keeps some exchange and has no critical value.
DYER_UNSTABLE = 16.0
BH_A, BH_B, BH_C, BH_D = 1.0, 2.0 / 3.0, 5.0, 0.35
ZETA_MIN = -10.0  # z/L floor in unstable air, beyond the range the Businger–Dyer functions were fitted on
STABLE_ITERATIONS = 8  # Newton passes on ln ζ for Ri_b → ζ in stable air (Ri_b matched to ~1e-4 for Ri_b up to 100)
MO_ITERATIONS = 8  # fixed-point passes for the Obukhov length in unstable air (ra within ~0.5 % of converged)
MO_TOLERANCE = 0.02  # relative change of z/L on the last pass above which the iteration counts as failed

# Free-convection velocity (Beljaars 1995, QJRMS 121, 255–270, https://doi.org/10.1002/qj.49712152203): the wind in
# the transfer law is |U|² = u² + w*², w* = (g/T · H/(ρ cp) · zi)^(1/3), zi = 1000 m "since only the order of
# magnitude matters" (ECMWF IFS Cy47r1 Part IV, Eq. 3.17–3.18).
BL_DEPTH = 1000.0
MIN_WIND = 0.1  # m s⁻¹, a numerical floor for calm, stable cases where w* = 0

# kB⁻¹ = ln(z0m/z0h) for vegetation: z0h = z0m/10, kB⁻¹ = ln 10 ≈ 2.3, close to the kB⁻¹ ≈ 2 of
# Garratt & Hicks (1973), QJRMS 99, 680–687, https://doi.org/10.1002/qj.49709942209, and Garratt & Francey (1978).
# Impervious, bare and water tiles use the calibrated Params.kb_inv (Kanda et al. 2007): z0m is the cell's, set by
# buildings and trees, while heat leaves these smooth surfaces through a much thinner roughness.
KB_INV_VEGETATION = float(np.log(10.0))

# Jarvis (1976)–Stewart (1988) canopy resistance, with the structure of Noilhan & Planton (1989), MWR 117, 536–549,
# https://doi.org/10.1175/1520-0493(1989)117<0536:ASPOLS>2.0.CO;2, and ECMWF IFS Cy47r1 Part IV Eq. 8.9–8.14:
# rs = rs_min / f2(θ) / f3(VPD), f2 = (θ − θ_pwp)/(θ_cap − θ_pwp) clipped to 0..1, 1/f3 = exp(g_D·VPD).
# The radiation factor f1 is ≈ 1 at the late-morning overpass (K↓ of several hundred W m⁻²) and is left out;
# Params.rs_min_* are canopy-level (already per unit leaf area index) and take the LAI term with them.
# g_D = 0.03 hPa⁻¹ for trees and 0 for grass and crops (IFS Table 8.1: non-zero for high vegetation only).
VPD_COEF_TREE = 0.03 * 10.0  # kPa⁻¹
# Soil moisture at saturation, field capacity and permanent wilting point, m³ m⁻³, "medium" texture of
# IFS Cy47r1 Part IV Table 8.9 (van Genuchten, loam-type soils of the Uzbek plains).
THETA_SAT = 0.439
THETA_CAP = 0.347
THETA_PWP = 0.151
F2_MIN = 1e-3  # caps the canopy resistance at 1000·rs_min in soil drier than the wilting point

# Bare-soil surface resistance, s m⁻¹: r_ss = exp(8.206 − 4.255·θ/θ_sat), Sellers et al. (1992), J. Geophys. Res.
# 97(D17), 19033–19059, https://doi.org/10.1029/92JD01096 (as tabulated by Tang & Riley 2013, HESS 17, 873–893,
# Table 1, https://doi.org/10.5194/hess-17-873-2013).
SELLERS_A = 8.206
SELLERS_B = 4.255


def saturation_vapour_pressure(t_k):
    """e_s(T), kPa (Eq. 27)."""
    t_c = np.asarray(t_k) - KELVIN
    return TETENS_E0 * np.exp(TETENS_A * t_c / (t_c + TETENS_B))


def psychrometric_constant(pressure_kpa):
    """γ = cp·p/(ε·Lv), kPa K⁻¹ (FAO-56 Eq. 8 with this model's cp and Lv)."""
    return CP_AIR * np.asarray(pressure_kpa) / (EPS_WATER * LV)


def air_density(pressure_kpa, t_air_k, e_air_kpa):
    """ρ = p / (Rd·Tv), Tv = T / (1 − 0.378·e/p), kg m⁻³ (Eq. 24, Eq. 29)."""
    t_virtual = t_air_k / (1.0 - (1.0 - EPS_WATER) * e_air_kpa / pressure_kpa)
    return pressure_kpa * 1e3 / (RD * t_virtual)


def psi_m(zeta):
    """Integrated stability function for momentum (Paulson 1970 unstable, Beljaars & Holtslag 1991 stable)."""
    zeta = np.asarray(zeta, dtype=float)
    x = np.sqrt(np.sqrt(1.0 - DYER_UNSTABLE * np.minimum(zeta, 0.0)))
    unstable = 2.0 * np.log((1.0 + x) / 2.0) + np.log((1.0 + x * x) / 2.0) - 2.0 * np.arctan(x) + np.pi / 2.0
    return np.where(zeta < 0.0, unstable, _stable_psi(np.maximum(zeta, 0.0))[0])


def psi_h(zeta):
    """Integrated stability function for heat and water vapour."""
    zeta = np.asarray(zeta, dtype=float)
    x2 = np.sqrt(1.0 - DYER_UNSTABLE * np.minimum(zeta, 0.0))
    return np.where(zeta < 0.0, 2.0 * np.log((1.0 + x2) / 2.0), _stable_psi(np.maximum(zeta, 0.0))[1])


def neutral_resistance(z, z0m, z0h, wind):
    """ra = ln(z/z0m)·ln(z/z0h) / (k²·u), s m⁻¹ (Eq. 23)."""
    return np.log(z / z0m) * np.log(z / z0h) / (VON_KARMAN ** 2 * wind)


def _stable_psi(zeta):
    """(ψm, ψh, dψm/dζ, dψh/dζ) for ζ ≥ 0 (Beljaars & Holtslag 1991)."""
    decay = np.exp(-BH_D * zeta)
    tail = BH_B * (zeta - BH_C / BH_D) * decay + BH_B * BH_C / BH_D
    tail_slope = BH_B * decay * (1.0 + BH_C - BH_D * zeta)
    root = np.sqrt(1.0 + 2.0 * BH_A * zeta / 3.0)
    return (-(BH_A * zeta + tail), -(root ** 3 + tail - 1.0),
            -(BH_A + tail_slope), -(BH_A * root + tail_slope))


def stable_zeta(bulk_richardson, z, z0m, z0h):
    """z/L in stable air from the bulk Richardson number: solves ζ·Lh(ζ)/Lm(ζ)² = Ri_b, where
    Lm = ln(z/z0m) − ψm(ζ) + ψm(ζ·z0m/z) and likewise Lh. Ri_b(ζ) rises without bound for the long-tailed
    functions, so Newton steps on ln ζ from the first-order guess ζ ≈ Ri_b·Lm(0)²/Lh(0) converge for any Ri_b > 0."""
    ri = np.maximum(bulk_richardson, 1e-12)
    log_m, log_h = np.log(z / z0m), np.log(z / z0h)
    rm, rh = z0m / z, z0h / z
    log_zeta = np.log(ri * log_m ** 2 / log_h)
    for _ in range(STABLE_ITERATIONS):
        zeta = np.exp(log_zeta)
        pm, ph, dpm, dph = _stable_psi(zeta)
        pm0, _, dpm0, _ = _stable_psi(zeta * rm)
        _, ph0, _, dph0 = _stable_psi(zeta * rh)
        integral_m = log_m - pm + pm0
        integral_h = log_h - ph + ph0
        mismatch = log_zeta + np.log(integral_h) - 2.0 * np.log(integral_m) - np.log(ri)
        slope = 1.0 + zeta * ((-dph + rh * dph0) / integral_h - 2.0 * (-dpm + rm * dpm0) / integral_m)
        log_zeta = log_zeta - np.clip(mismatch / np.maximum(slope, 0.1), -2.0, 2.0)
    return np.where(bulk_richardson > 0.0, np.exp(log_zeta), 0.0)


def _stability_terms(zeta, z, z0m, z0h):
    """The profile integrals ln(z/z0) − ψ(ζ) + ψ(ζ·z0/z) for momentum and heat."""
    return (np.log(z / z0m) - psi_m(zeta) + psi_m(zeta * z0m / z),
            np.log(z / z0h) - psi_h(zeta) + psi_h(zeta * z0h / z))


def _unstable_integrals(zeta, log_m, log_h, z0m_over_z, z0h_over_z):
    """_stability_terms for ζ < 0 only (Paulson 1970), without the stable branch: this is the hot loop."""
    def x_of(value):
        return np.sqrt(np.sqrt(1.0 - DYER_UNSTABLE * value))

    def psi_pair(x):
        log_x2 = np.log((1.0 + x * x) / 2.0)
        return 2.0 * np.log((1.0 + x) / 2.0) + log_x2 - 2.0 * np.arctan(x) + np.pi / 2.0, 2.0 * log_x2

    psi_m_z, psi_h_z = psi_pair(x_of(zeta))
    psi_m_0, _ = psi_pair(x_of(zeta * z0m_over_z))
    _, psi_h_0 = psi_pair(x_of(zeta * z0h_over_z))
    return log_m - psi_m_z + psi_m_0, log_h - psi_h_z + psi_h_0


def _unstable(excess, t_air, calm, z, z0m, z0h):
    """Fixed-point iteration for z/L and the free-convection wind on elements with a warmer surface, from the
    first-order estimate ζ ≈ Ri_b·ln(z/z0m)²/ln(z/z0h). The pass count is fixed so ra(T) stays a smooth function
    of the surface temperature, which the Newton solver and the Λ finite difference rely on."""
    log_m, log_h = np.log(z / z0m), np.log(z / z0h)
    z0m_over_z, z0h_over_z = z0m / z, z0h / z
    zeta = np.maximum(-GRAVITY * z * excess / (t_air * calm * calm) * log_m * log_m / log_h, ZETA_MIN)
    speed = calm
    step = np.zeros_like(zeta)
    for _ in range(MO_ITERATIONS):
        integral_m, integral_h = _unstable_integrals(zeta, log_m, log_h, z0m_over_z, z0h_over_z)
        u_star = VON_KARMAN * speed / integral_m
        heat = excess * VON_KARMAN * u_star / integral_h  # H/(ρ cp), K m s⁻¹
        speed = np.sqrt(calm * calm + np.cbrt(GRAVITY / t_air * heat * BL_DEPTH) ** 2)
        target = np.maximum(-VON_KARMAN * GRAVITY * z * heat / (u_star ** 3 * t_air), ZETA_MIN)
        step = target - zeta
        zeta = target
    unsettled = np.abs(step) > MO_TOLERANCE * np.maximum(1.0, np.abs(zeta))
    return zeta, speed, unsettled


def aerodynamic_resistance(t_surface, t_air, wind, z, z0m, z0h):
    """ra with Monin–Obukhov stability and the free-convection wind (Eq. 22–24 with ψ corrections).

    Stable air (surface colder than the air) inverts the bulk Richardson number for z/L by Newton steps. Unstable
    air iterates the Obukhov length a fixed number of times, with the convective velocity added to the wind.
    Returns (ra, fallback): fallback marks elements where the unstable iteration did not settle and the neutral
    resistance (with the last effective wind) was used instead.
    """
    arrays = np.broadcast_arrays(*(np.asarray(v, dtype=float) for v in (t_surface, t_air, wind, z, z0m, z0h)))
    shape = arrays[0].shape
    t_surface, t_air, wind, z, z0m, z0h = (a.reshape(-1) for a in arrays)
    calm = np.maximum(wind, MIN_WIND)
    excess = t_surface - t_air
    zeta = np.zeros_like(excess)
    speed = calm.copy()
    fallback = np.zeros(excess.shape, dtype=bool)

    stable = excess < 0.0
    richardson = GRAVITY * z[stable] * (-excess[stable]) / (t_air[stable] * calm[stable] ** 2)
    zeta[stable] = stable_zeta(richardson, z[stable], z0m[stable], z0h[stable])
    up = excess > 0.0
    zeta[up], speed[up], fallback[up] = _unstable(excess[up], t_air[up], calm[up], z[up], z0m[up], z0h[up])

    integral_m, integral_h = _stability_terms(zeta, z, z0m, z0h)
    ra = integral_m * integral_h / (VON_KARMAN ** 2 * speed)
    fallback |= ~np.isfinite(ra) | (ra <= 0.0)
    ra = np.where(fallback, neutral_resistance(z, z0m, z0h, speed), ra)
    return ra.reshape(shape), fallback.reshape(shape)


def _cell(value, n):
    """A per-cell forcing value (scalar or (n,)) as an (n, 1) column."""
    return np.broadcast_to(np.asarray(value, dtype=float), (n,))[:, None]


def tile_mask(names):
    mask = np.zeros(len(TILES), dtype=bool)
    mask[[TILE[name] for name in names]] = True
    return mask


@dataclass
class Setup:
    """Everything temperature-independent, broadcast to (n, T)."""

    t_air: np.ndarray
    e_air: np.ndarray
    emissivity: np.ndarray
    shortwave_absorbed: np.ndarray  # (1 − α)·K↓_tile
    longwave_in: np.ndarray  # ε·L↓_tile
    rho_cp: np.ndarray
    psy: np.ndarray  # γ, kPa K⁻¹
    wind: np.ndarray
    z: np.ndarray  # z_ref − zd
    z0m: np.ndarray
    z0h: np.ndarray
    rs: np.ndarray  # surface resistance, s m⁻¹; inf where there is no evaporation
    a1: np.ndarray
    storage_offset: np.ndarray  # a2·dRn/dt + a3
    qf: np.ndarray
    conductance_scale: float = 1.0  # multiplies 1/ra; 0 switches turbulent exchange off (radiation-only limit)

    def take(self, index) -> "Setup":
        """The elements at `index` of the flattened (n, T) arrays, as a 1-D setup."""
        return Setup(**{name: (value.reshape(-1)[index] if isinstance(value, np.ndarray) else value)
                        for name, value in vars(self).items()})


def shortwave_share(inputs: SebInputs, forcing: Forcing) -> np.ndarray:
    """K↓_tile / K↓: sunlit part gets everything, shaded part only the diffuse light (Eq. 30)."""
    n = len(inputs.z0m)
    diffuse = np.clip(_cell(forcing.diffuse_fraction, n), 0.0, 1.0)
    return 1.0 - np.clip(inputs.shade, 0.0, 1.0) * (1.0 - diffuse)


def longwave_down_tile(inputs: SebInputs, forcing: Forcing, t_air) -> np.ndarray:
    """L↓ per tile: open sky for roofs, trees and water; sky plus walls at air temperature on the canyon floor."""
    n = len(inputs.z0m)
    l_down = _cell(forcing.l_down, n)
    svf = np.clip(inputs.sky_view, 0.0, 1.0)[:, None]
    canyon = svf * l_down + (1.0 - svf) * SIGMA * t_air ** 4
    return np.where(tile_mask(CANYON_FLOOR), canyon, l_down) * np.ones((1, len(TILES)))


def surface_resistance(inputs: SebInputs, forcing: Forcing, params: Params, t_air) -> np.ndarray:
    """rs per tile, s m⁻¹ (theory section 5.3); inf for impervious tiles (LE = 0), 0 for water."""
    n = len(inputs.z0m)
    vpd = np.maximum(saturation_vapour_pressure(t_air) - _cell(forcing.e_air, n), 0.0)
    theta = np.asarray(inputs.soil_moisture, dtype=float)[:, None]
    f2 = np.clip((theta - THETA_PWP) / (THETA_CAP - THETA_PWP), F2_MIN, 1.0)
    f2 = np.where(np.asarray(inputs.irrigated, dtype=bool)[:, None], 1.0, f2)
    rural = np.asarray(inputs.rural, dtype=bool)[:, None]

    rs = np.full((n, len(TILES)), np.inf)
    rs[:, [TILE["tree"]]] = params.rs_min_tree * np.exp(VPD_COEF_TREE * vpd) / f2
    grass_min = np.where(rural, params.rs_min_crop, params.rs_min_grass)
    rs[:, [TILE["grass"]]] = grass_min / f2
    soil = np.exp(SELLERS_A - SELLERS_B * np.clip(theta / THETA_SAT, 0.0, 1.0))
    rs[:, [TILE["bare"]]] = soil * params.soil_resistance_scale
    rs[:, TILE["water"]] = 0.0
    return rs


def anthropogenic_heat(inputs: SebInputs) -> np.ndarray:
    """QF per tile: all of it on the impervious tiles in proportion to their area, so the cell mean is inputs.qf.
    A cell without impervious surface gets it on every tile evenly."""
    impervious = tile_mask(IMPERVIOUS)
    share = np.sum(inputs.fraction * impervious, axis=1, keepdims=True)
    qf = np.asarray(inputs.qf, dtype=float)[:, None]
    on_impervious = np.where(impervious, qf / np.where(share > 0, share, 1.0), 0.0)
    return np.where(share > 0, on_impervious, qf * np.ones((1, len(TILES))))


def prepare(inputs: SebInputs, forcing: Forcing, params: Params) -> Setup:
    n, n_tiles = inputs.fraction.shape
    ones = np.ones((n, n_tiles))
    t_air = _cell(forcing.t_air, n) + params.d_t_air
    e_air = _cell(forcing.e_air, n)
    pressure = _cell(forcing.pressure, n)
    albedo = np.asarray(inputs.albedo, dtype=float)
    emissivity = np.asarray(inputs.emissivity, dtype=float)
    share = shortwave_share(inputs, forcing)

    z0m = np.maximum(np.asarray(inputs.z0m, dtype=float), 1e-4)[:, None]
    # The reference height must clear the roughness: at least 5·z0m above the displacement height.
    z = np.maximum(forcing.z_ref - np.asarray(inputs.zd, dtype=float)[:, None], 5.0 * z0m)
    kb_inv = np.where(tile_mask(VEGETATED), KB_INV_VEGETATION, params.kb_inv)

    a1 = inputs.ohm[..., 0] * np.where(tile_mask(IMPERVIOUS), params.ohm_a1_scale, 1.0)
    d_rn_dt = (1.0 - albedo) * share * forcing.dk_dt  # W m⁻² h⁻¹
    return Setup(
        t_air=t_air * ones,
        e_air=e_air * ones,
        emissivity=emissivity,
        shortwave_absorbed=(1.0 - albedo) * share * _cell(forcing.k_down, n),
        longwave_in=emissivity * longwave_down_tile(inputs, forcing, t_air),
        rho_cp=air_density(pressure, t_air, e_air) * CP_AIR * ones,
        psy=psychrometric_constant(pressure) * ones,
        wind=_cell(forcing.wind, n) * ones,
        z=z * ones,
        z0m=z0m * ones,
        z0h=z0m * np.exp(-kb_inv),
        rs=surface_resistance(inputs, forcing, params, t_air),
        a1=a1,
        storage_offset=inputs.ohm[..., 1] * d_rn_dt + inputs.ohm[..., 2],
        qf=anthropogenic_heat(inputs),
    )


def fluxes(setup: Setup, t_surface: np.ndarray) -> dict:
    """Every term of Eq. 5 at the trial temperature, plus the residual F and the stability-fallback flag."""
    rn = setup.shortwave_absorbed + setup.longwave_in - setup.emissivity * SIGMA * t_surface ** 4
    ra, fallback = aerodynamic_resistance(t_surface, setup.t_air, setup.wind, setup.z, setup.z0m, setup.z0h)
    conductance = setup.conductance_scale / ra
    h = setup.rho_cp * (t_surface - setup.t_air) * conductance
    deficit = saturation_vapour_pressure(t_surface) - setup.e_air
    # LE = (ρ cp/γ)·(e_s(T) − e_a)/(ra + rs), written with conductances so rs = inf gives exactly 0.
    with np.errstate(divide="ignore"):
        le_conductance = 1.0 / (1.0 / conductance + setup.rs)
    le = setup.rho_cp / setup.psy * deficit * le_conductance
    dqs = setup.a1 * rn + setup.storage_offset
    residual = rn + setup.qf - h - le - dqs
    return {"rn": rn, "h": h, "le": le, "dqs": dqs, "qf": setup.qf, "residual": residual, "fallback": fallback}
