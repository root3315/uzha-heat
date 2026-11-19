"""Shared types of the physics model: a per-cell surface energy balance, solved per surface tile.

Equation numbers refer to the team's theory notes (docs/theory.pdf, "Urban heat islands: physics and mathematical
framework"). Sign convention (theory section 1): Rn and QF positive into the surface; H and LE positive upward, surface
to air; ΔQS positive when energy is stored. Each tile k of a cell solves F_k(T_k) = Rn + QF − H − LE − ΔQS = 0 (Eq. 5–6,
QA = 0, G inside ΔQS so it is not counted twice, theory section 2.2).

All arrays are numpy float64. n is the number of cells, T = len(TILES). Temperatures are in kelvin inside the model
(Eq. 3); converting to °C is the exporter's job.
"""
from dataclasses import dataclass, field, fields

import numpy as np

# The surface tiles a 200 m cell is split into (Eq. 48, mosaic approach).
TILES = ("tree", "grass", "bare", "roof", "road", "paved", "water")
TILE = {name: k for k, name in enumerate(TILES)}
VEGETATED = ("tree", "grass")
IMPERVIOUS = ("roof", "road", "paved")
# Ground-level tiles that buildings can shade and that see the street canyon rather than the open sky.
CANYON_FLOOR = ("road", "paved", "grass", "bare")

SIGMA = 5.670374419e-8  # Stefan–Boltzmann, W m⁻² K⁻⁴
CP_AIR = 1005.0  # J kg⁻¹ K⁻¹
VON_KARMAN = 0.40
LV = 2.45e6  # J kg⁻¹
RD = 287.05  # J kg⁻¹ K⁻¹
KELVIN = 273.15


@dataclass
class Forcing:
    """The weather at the overpass, per cell (arrays of n) or one value for the whole city (broadcast)."""

    k_down: np.ndarray  # incoming shortwave on a horizontal surface, W m⁻² (Eq. 15)
    diffuse_fraction: np.ndarray  # K_diffuse / K_down, 0..1
    l_down: np.ndarray  # incoming longwave, W m⁻² (Eq. 14)
    t_air: np.ndarray  # air temperature at the reference height, K, already corrected for the cell's elevation (Eq. 47)
    e_air: np.ndarray  # vapour pressure of the air, kPa
    pressure: np.ndarray  # kPa
    wind: np.ndarray  # wind speed at z_ref, m s⁻¹
    z_ref: float  # reference (blending) height for wind and air temperature, m
    zenith: float  # solar zenith angle, rad (Eq. 17)
    dk_dt: float  # dK_down/dt at the overpass, W m⁻² h⁻¹, for the OHM hysteresis term


@dataclass
class SebInputs:
    """What the solver needs about each cell and tile. Per-tile arrays have shape (n, T); per-cell arrays (n,)."""

    fraction: np.ndarray  # (n, T) area share of each tile, rows sum to 1 (Eq. 48)
    albedo: np.ndarray  # (n, T) broadband albedo (Eq. 7–9)
    emissivity: np.ndarray  # (n, T) (Eq. 10–11)
    shade: np.ndarray  # (n, T) share of the tile shaded from the direct beam, 0..1 (Eq. 30, buildings and trees)
    sky_view: np.ndarray  # (n,) sky-view factor of the canyon floor, 0..1 (Eq. 20); 1 in open land
    z0m: np.ndarray  # (n,) roughness length for momentum, m
    zd: np.ndarray  # (n,) zero-plane displacement height, m
    soil_moisture: np.ndarray  # (n,) volumetric water content of the top soil, m³ m⁻³ (Eq. 39)
    irrigated: np.ndarray  # (n,) bool: vegetation here is watered (no soil-moisture stress)
    ohm: np.ndarray  # (n, T, 3) objective hysteresis model coefficients a1 (-), a2 (h), a3 (W m⁻²) for ΔQS
    qf: np.ndarray  # (n,) anthropogenic heat flux, W m⁻² (Eq. 44), spread over the impervious tiles
    rural: np.ndarray  # (n,) bool: the cell belongs to the ring around the city (crops there get their own resistance)

    def __post_init__(self):
        n = len(self.z0m)
        for f in fields(self):
            value = getattr(self, f.name)
            expected = {"fraction": (n, len(TILES)), "albedo": (n, len(TILES)), "emissivity": (n, len(TILES)),
                        "shade": (n, len(TILES)), "ohm": (n, len(TILES), 3)}.get(f.name, (n,))
            if np.shape(value) != expected:
                raise ValueError(f"SebInputs.{f.name}: shape {np.shape(value)}, expected {expected}")


@dataclass
class Params:
    """The few global parameters calibrated against Landsat LST, each with a literature prior and bounds."""

    kb_inv: float = 6.0  # ln(z0m/z0h) for urban surfaces (Kanda et al. 2007 give ~ 5–20)
    rs_min_tree: float = 100.0  # minimum stomatal resistance, s m⁻¹ (Noilhan & Planton 1989)
    rs_min_grass: float = 60.0
    rs_min_crop: float = 60.0  # irrigated crops of the ring
    soil_resistance_scale: float = 1.0  # multiplies the bare-soil surface resistance (Sellers et al. 1992)
    ohm_a1_scale: float = 1.0  # multiplies a1 of the impervious tiles
    d_t_air: float = 0.0  # global offset of the air temperature, K (ERA5 representativeness, LST level bias)

    BOUNDS = {
        "kb_inv": (2.0, 20.0),
        "rs_min_tree": (40.0, 400.0),
        "rs_min_grass": (30.0, 300.0),
        "rs_min_crop": (20.0, 300.0),
        "soil_resistance_scale": (0.2, 5.0),
        "ohm_a1_scale": (0.3, 2.0),
        "d_t_air": (-5.0, 5.0),
    }

    def vector(self) -> np.ndarray:
        return np.array([getattr(self, name) for name in self.BOUNDS])

    @classmethod
    def from_vector(cls, values) -> "Params":
        return cls(**dict(zip(cls.BOUNDS, (float(v) for v in values))))


@dataclass
class TileState:
    """The solution: each tile's equilibrium temperature and its fluxes, all (n, T) in K and W m⁻²."""

    t_surface: np.ndarray
    rn: np.ndarray
    h: np.ndarray
    le: np.ndarray
    dqs: np.ndarray
    qf: np.ndarray
    residual: np.ndarray  # F_k at the returned T_k, W m⁻²: the energy-balance closure (theory section 12)
    converged: np.ndarray  # (n, T) bool
    t_cell: np.ndarray = field(default=None)  # (n,) radiance-weighted cell temperature, K (Eq. 48 note)
    # (n, T) bool: the Monin–Obukhov iteration did not settle at T_k and the neutral resistance was used
    stability_fallback: np.ndarray = field(default=None)
