import numpy as np

from pipeline import photo


def test_tone_stretches_to_eight_bits_and_fills_gaps():
    rng = np.random.default_rng(0)
    rgb = rng.uniform(0.02, 0.3, size=(3, 40, 40)).astype(np.float32)
    rgb[:, 0, 0] = np.nan
    picture = photo.tone(rgb)
    assert picture.shape == (40, 40, 3) and picture.dtype == np.uint8
    assert picture.min() == 0 and picture.max() == 255
    assert (picture[0, 0] == 0).all(), "a pixel never seen clear is dark, not noise"


def test_tone_keeps_grey_grey():
    grey = np.tile(np.linspace(0.05, 0.25, 20, dtype=np.float32), (3, 20, 1))
    picture = photo.tone(grey).astype(int)
    assert np.abs(picture[..., 0] - picture[..., 2]).max() <= 1
