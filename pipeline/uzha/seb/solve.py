"""Vectorised root finder for the per-tile surface energy balance F_k(T_k) = 0 (docs/theory.pdf, Eq. 5–6).

Every (cell, tile) pair is solved at once by a bracketed Newton method on [Ta − 15 K, Ta + 45 K]: the slope is the
secant through the last two iterates (one residual evaluation per pass instead of two for a difference derivative),
the bracket shrinks with the sign of F, and a bisection step is taken whenever the step would leave the bracket or
|F| did not halve. A pair counts as converged when |F| < 0.1 W m⁻² (it is driven to 1e-4).
A pair whose residual does not change sign over the bracket is not forced to a temperature: it is returned at the
bracket end with the smaller |F| and marked as not converged (theory section 2.1).
"""
import numpy as np

from . import physics
from .types import Forcing, Params, SebInputs, SIGMA, TileState

BRACKET_BELOW = 15.0  # K under the air temperature
BRACKET_ABOVE = 45.0  # K over it
TOLERANCE = 1e-4  # W m⁻², |F| at which a pair is done
CLOSURE = 0.1  # W m⁻², |F| up to which a pair counts as converged
MAX_ITERATIONS = 60
BRACKET_FLOOR = 1e-9  # K, a bracket this narrow cannot be refined further
SENSITIVITY_STEP = 0.05  # K, central difference for Λ


def _iterate(setup: physics.Setup, lower, upper, f_lower, f_upper):
    """Safeguarded secant (Newton with the slope through the last two iterates) on 1-D arrays that bracket a root,
    F(lower) ≥ 0 ≥ F(upper), falling back to bisection. Only elements not yet
    done are evaluated on each pass, one residual evaluation per pass."""
    with np.errstate(divide="ignore", invalid="ignore"):
        t = np.where(f_lower > f_upper, lower + f_lower * (upper - lower) / (f_lower - f_upper), lower)
    t = np.clip(t, lower, upper)
    t_prev, f_prev = upper.copy(), f_upper.copy()
    active = np.arange(t.size)
    part = setup
    for _ in range(MAX_ITERATIONS):
        t_a, lo, hi = t[active], lower[active], upper[active]
        f = physics.fluxes(part, t_a)["residual"]
        open_ = (np.abs(f) >= TOLERANCE) & (hi - lo > BRACKET_FLOOR)
        if not open_.any():
            break
        part = part.take(open_)
        active, t_a, f, lo, hi = active[open_], t_a[open_], f[open_], lo[open_], hi[open_]
        lo = np.where(f > 0.0, t_a, lo)
        hi = np.where(f > 0.0, hi, t_a)
        with np.errstate(divide="ignore", invalid="ignore"):
            slope = (f - f_prev[active]) / (t_a - t_prev[active])
            secant = t_a - f / slope
        # Bisect when the secant would leave the bracket or the last step did not halve |F| (a secant creeping
        # along one side of a strongly curved F, as in stable air near the critical Richardson number).
        inside = (slope < 0.0) & (secant > lo) & (secant < hi) & (np.abs(f) < 0.5 * np.abs(f_prev[active]))
        t_prev[active], f_prev[active] = t_a, f
        t[active] = np.where(inside, secant, 0.5 * (lo + hi))
        lower[active], upper[active] = lo, hi
    return t


def solve_setup(setup: physics.Setup) -> dict:
    """Root of F for every element of a prepared setup; returns the fluxes at the root plus `converged`."""
    shape = setup.t_air.shape
    flat = setup.take(slice(None))
    lower = flat.t_air - BRACKET_BELOW
    upper = flat.t_air + BRACKET_ABOVE
    f_lower = physics.fluxes(flat, lower)["residual"]
    f_upper = physics.fluxes(flat, upper)["residual"]
    bracketed = (f_lower >= 0.0) & (f_upper <= 0.0)

    # Unbracketed pairs stay at the bracket end with the smaller |F| and are reported, not forced.
    t = np.where(np.abs(f_lower) < np.abs(f_upper), lower, upper)
    inside = np.flatnonzero(bracketed)
    t[inside] = _iterate(flat.take(inside), lower[inside], upper[inside], f_lower[inside], f_upper[inside])

    t = t.reshape(shape)
    result = physics.fluxes(setup, t)
    result["t_surface"] = t
    result["converged"] = bracketed.reshape(shape) & (np.abs(result["residual"]) < CLOSURE)
    return result


def cell_temperature(fraction, emissivity, t_surface):
    """Radiance-weighted cell temperature (Σ f ε T⁴ / Σ f ε)^(1/4) over the tiles present (theory section 10)."""
    weight = np.where(fraction > 0.0, fraction * emissivity, 0.0)
    radiance = np.sum(weight * SIGMA * t_surface ** 4, axis=1) / np.sum(weight, axis=1)
    return (radiance / SIGMA) ** 0.25


def solve(inputs: SebInputs, forcing: Forcing, params: Params) -> TileState:
    """Equilibrium temperature and fluxes of every tile of every cell."""
    result = solve_setup(physics.prepare(inputs, forcing, params))
    return TileState(
        t_surface=result["t_surface"],
        rn=result["rn"],
        h=result["h"],
        le=result["le"],
        dqs=result["dqs"],
        qf=result["qf"],
        residual=result["residual"],
        converged=result["converged"],
        t_cell=cell_temperature(inputs.fraction, inputs.emissivity, result["t_surface"]),
        stability_fallback=result["fallback"],
    )


def linear_sensitivity(inputs: SebInputs, forcing: Forcing, params: Params, state: TileState) -> np.ndarray:
    """Restoring conductance Λ = −∂F/∂T at the solution, W m⁻² K⁻¹, (n, T) (Eq. 50–52), by central difference.

    A small energy perturbation δE then moves the tile by δT ≈ δE / Λ (Eq. 51)."""
    setup = physics.prepare(inputs, forcing, params)
    up = physics.fluxes(setup, state.t_surface + SENSITIVITY_STEP)["residual"]
    down = physics.fluxes(setup, state.t_surface - SENSITIVITY_STEP)["residual"]
    return -(up - down) / (2.0 * SENSITIVITY_STEP)
