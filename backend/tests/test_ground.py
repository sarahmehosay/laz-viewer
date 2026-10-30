import numpy as np

from app.ground import GroundParams, extract_ground


def _scene():
    rng = np.random.default_rng(0)
    n = 60_000
    x, y = rng.uniform(0, 100, n), rng.uniform(0, 100, n)
    z = 0.05 * x + rng.normal(0, 0.02, n)           # gentle slope
    # 20x20 m "building" 8 m above ground
    b = (x > 40) & (x < 60) & (y > 40) & (y < 60)
    z[b] += 8
    return x, y, z, b


def test_removes_building_keeps_terrain():
    x, y, z, b = _scene()
    res = extract_ground(x, y, z, GroundParams())
    assert not res.is_ground[b].any()
    assert res.is_ground[~b].mean() > 0.95


def test_empty_raises():
    import pytest
    e = np.array([])
    with pytest.raises(ValueError):
        extract_ground(e, e, e, GroundParams())
