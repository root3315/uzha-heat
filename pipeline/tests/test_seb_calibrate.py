import numpy as np

from pipeline.uzha.seb import calibrate
from pipeline.uzha.seb.inputs import vegetation_cover
from pipeline.uzha.seb.types import TILES, Forcing, Params, SebInputs


def _city(n=60, seed=0):
    rng = np.random.default_rng(seed)
    t = len(TILES)
    fraction = rng.uniform(0, 1, (n, t))
    fraction /= fraction.sum(axis=1, keepdims=True)
    ohm = np.tile(np.array([[0.11, 0.11, -12.3], [0.32, 0.54, -27.4], [0.35, 0.43, -36.5], [0.48, 0.34, -33.9],
                            [0.61, 0.41, -27.7], [0.83, 0.40, -54.2], [0.50, 0.21, -39.1]]), (n, 1, 1))
    inputs = SebInputs(fraction=fraction, albedo=np.tile([0.16, 0.21, 0.25, 0.2, 0.12, 0.18, 0.08], (n, 1)),
                       emissivity=np.tile([0.98, 0.95, 0.93, 0.91, 0.95, 0.9, 0.96], (n, 1)), shade=np.zeros((n, t)),
                       sky_view=np.ones(n), z0m=np.full(n, 0.5), zd=np.full(n, 3.0), soil_moisture=np.full(n, 0.2),
                       irrigated=np.ones(n, bool), ohm=ohm, qf=np.zeros(n), rural=np.zeros(n, bool))
    forcing = Forcing(k_down=np.full(n, 800.0), diffuse_fraction=np.full(n, 0.2), l_down=np.full(n, 395.0),
                      t_air=np.full(n, 305.0), e_air=np.full(n, 1.45), pressure=np.full(n, 95.8),
                      wind=np.full(n, 2.1), z_ref=60.0, zenith=0.52, dk_dt=66.0)
    return inputs, forcing


def test_fit_recovers_the_air_offset_that_made_the_observations():
    inputs, forcing = _city()
    truth = Params(d_t_air=2.0)
    observed = calibrate.predict(inputs, forcing, truth)
    fitted = calibrate.fit(inputs, forcing, observed, np.arange(len(observed)), start=Params())
    assert calibrate.score(calibrate.predict(inputs, forcing, fitted), observed).mae < 0.2


def test_subset_keeps_city_wide_forcing_values():
    inputs, forcing = _city()
    part, forced = calibrate.subset(inputs, forcing, np.array([0, 5, 7]))
    assert part.fraction.shape == (3, len(TILES)) and forced.t_air.shape == (3,) and forced.z_ref == 60.0


def test_score_reports_bias_as_model_minus_observed():
    s = calibrate.score(np.array([301.0, 303.0]), np.array([300.0, 302.0]))
    assert s.bias == 1.0 and s.mae == 1.0


def test_vegetation_cover_is_linear_between_soil_and_canopy():
    assert np.allclose(vegetation_cover([0.15, 0.45, 0.75, 0.9]), [0.0, 0.5, 1.0, 1.0])


def test_hybrid_correction_learns_what_the_physics_misses():
    inputs, forcing = _city(n=120)
    rng = np.random.default_rng(3)
    factors = rng.uniform(0, 1, (120, 2))
    physics = calibrate.predict(inputs, forcing, Params())
    observed = physics + 3.0 * factors[:, 0]  # a pattern the physics cannot see
    x = np.repeat(np.arange(12) * 2500.0, 10)
    y = np.tile(np.arange(10) * 2500.0, 12)
    hybrid, plain, _ = calibrate.cross_validate_hybrid(inputs, forcing, observed, factors, x, y, folds=3)
    assert calibrate.score(hybrid, observed).mae < calibrate.score(plain, observed).mae
