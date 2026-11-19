"""Calibrate the energy balance model's few global parameters against Landsat LST, and score it out of fold.

The model predicts each cell's surface temperature from physics; seven global parameters (types.Params, each with a
literature range) are uncertain. They are fitted by robust least squares on cells of the training blocks only and the
model is scored on held-out 2 km blocks, the same spatial cross-validation as the XGBoost model (pipeline/uzha/cv.py),
so the two can be compared. The residual LST − model (theory Eq. 62) is kept per cell.
"""
from dataclasses import dataclass

import numpy as np
from scipy.optimize import least_squares

from ..cv import spatial_folds
from ..model import BLOCK_SIZE_M, CV_FOLDS
from .solve import solve
from .types import Forcing, Params, SebInputs

TRAIN_CELLS = 2500  # cells per fit: enough for seven parameters, and each fit stays within minutes
HUBER_K = 1.5  # K: past this a misfit counts linearly, so runways and reservoirs do not steer the parameters
FIT_EXTRA = ()  # optional parameters (Params.OPTIONAL_BOUNDS) fitted by default, e.g. ("kb_inv_bare",)


def subset(inputs: SebInputs, forcing: Forcing, cells: np.ndarray) -> tuple:
    """The inputs and forcing of some cells only."""
    pick = lambda value: value[cells] if isinstance(value, np.ndarray) and value.ndim >= 1 and len(value) == len(inputs.z0m) else value
    part = SebInputs(**{name: pick(getattr(inputs, name)) for name in inputs.__dataclass_fields__})
    forced = Forcing(**{name: pick(np.asarray(getattr(forcing, name))) if np.ndim(getattr(forcing, name)) else getattr(forcing, name)
                        for name in forcing.__dataclass_fields__})
    return part, forced


def predict(inputs: SebInputs, forcing: Forcing, params: Params) -> np.ndarray:
    """Cell surface temperature, K; NaN where a tile did not converge."""
    state = solve(inputs, forcing, params)
    return np.where(state.converged.all(axis=1), state.t_cell, np.nan)


def fit(inputs: SebInputs, forcing: Forcing, observed: np.ndarray, cells: np.ndarray, start: Params = Params(),
        seed: int = 0, names: tuple = None) -> Params:
    """The parameters that bring the model closest to the observed LST on `cells` (a sample of them), within bounds.

    `names` are the parameters fitted (default: Params.BOUNDS, plus FIT_EXTRA); the others keep their `start` value.
    """
    rng = np.random.default_rng(seed)
    cells = np.asarray(cells)
    if len(cells) > TRAIN_CELLS:
        cells = rng.choice(cells, TRAIN_CELLS, replace=False)
    part, forced = subset(inputs, forcing, cells)
    target = observed[cells]
    names = list(names or (*Params.BOUNDS, *FIT_EXTRA))
    lower = np.array([Params.bounds(n)[0] for n in names])
    upper = np.array([Params.bounds(n)[1] for n in names])
    scale = upper - lower

    def residuals(unit):
        misfit = predict(part, forced, Params.from_vector(lower + unit * scale, names, start)) - target
        return np.where(np.isfinite(misfit), misfit, 10.0)  # a cell the solver could not close counts as a large miss

    initial = start.vector(names)
    initial = np.where(np.isfinite(initial), initial, start.kb_inv)  # an unset kb_inv_bare starts from kb_inv
    unit0 = np.clip((initial - lower) / scale, 0.0, 1.0)
    result = least_squares(residuals, unit0, bounds=(0.0, 1.0), loss="huber", f_scale=HUBER_K, diff_step=0.02,
                           x_scale="jac", max_nfev=60)
    return Params.from_vector(lower + result.x * scale, names, start)


@dataclass
class Score:
    r2: float
    mae: float
    bias: float  # model − observed, K
    rmse: float


def score(predicted: np.ndarray, observed: np.ndarray, where: np.ndarray = None) -> Score:
    ok = np.isfinite(predicted) & np.isfinite(observed) & (True if where is None else where)
    error = predicted[ok] - observed[ok]
    spread = ((observed[ok] - observed[ok].mean()) ** 2).sum()
    return Score(r2=float(1 - (error ** 2).sum() / spread), mae=float(np.abs(error).mean()), bias=float(error.mean()),
                 rmse=float(np.sqrt((error ** 2).mean())))


def cross_validate(inputs: SebInputs, forcing: Forcing, observed: np.ndarray, x: np.ndarray, y: np.ndarray,
                   folds: int = CV_FOLDS, block_m: float = BLOCK_SIZE_M) -> tuple:
    """(out-of-fold prediction per cell, parameters fitted in each fold): every cell predicted by a fit that never
    saw its 2 km block."""
    predicted = np.full(len(observed), np.nan)
    fitted = []
    for k, (train, test) in enumerate(spatial_folds(x, y, block_m, folds)):
        params = fit(inputs, forcing, observed, train, seed=k)
        fitted.append(params)
        part, forced = subset(inputs, forcing, test)
        predicted[test] = predict(part, forced, params)
    return predicted, fitted


def residual_model():
    """A small boosted model for what the physics misses: shallow and strongly regularised, so it corrects the balance
    rather than replacing it."""
    import xgboost as xgb

    return xgb.XGBRegressor(n_estimators=300, max_depth=4, learning_rate=0.05, subsample=0.8, colsample_bytree=0.8,
                            min_child_weight=20, reg_lambda=5.0, random_state=42, n_jobs=2)


def cross_validate_hybrid(inputs: SebInputs, forcing: Forcing, observed: np.ndarray, factors: np.ndarray,
                          x: np.ndarray, y: np.ndarray, folds: int = CV_FOLDS, block_m: float = BLOCK_SIZE_M) -> tuple:
    """Physics plus a learned correction, scored out of fold: in each fold the physics parameters and the correction
    are fitted on the training blocks only, then both predict the held-out block.

    Returns (hybrid prediction, physics-only prediction, fitted parameters per fold), all K.
    """
    hybrid = np.full(len(observed), np.nan)
    physics = np.full(len(observed), np.nan)
    fitted = []
    for k, (train, test) in enumerate(spatial_folds(x, y, block_m, folds)):
        params = fit(inputs, forcing, observed, train, seed=k)
        fitted.append(params)
        everywhere = predict(inputs, forcing, params)
        ok = train[np.isfinite(everywhere[train]) & np.isfinite(observed[train])]
        correction = residual_model().fit(factors[ok], observed[ok] - everywhere[ok])
        physics[test] = everywhere[test]
        hybrid[test] = everywhere[test] + correction.predict(factors[test])
    return hybrid, physics, fitted
