import numpy as np
import pytest

from app.ground import GroundParams, _window_sizes, extract_ground


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


def test_building_larger_than_max_window_is_kept_as_ground():
    x, y, z, b = _scene()
    res = extract_ground(x, y, z, GroundParams(max_window=10))
    assert res.is_ground[b].mean() > 0.5


def test_flat_terrain_is_all_ground():
    rng = np.random.default_rng(2)
    x, y = rng.uniform(0, 30, 5_000), rng.uniform(0, 30, 5_000)
    res = extract_ground(x, y, np.zeros_like(x), GroundParams())
    assert res.is_ground.all()


def test_result_geometry():
    x = np.array([10.0, 14.9, 10.0])
    y = np.array([-5.0, -5.0, 2.9])
    res = extract_ground(x, y, np.zeros(3), GroundParams(cell_size=1.0, max_window=3))
    assert res.origin == (10.0, -5.0)
    assert res.cell_size == 1.0
    assert res.dem.shape == (8, 5)  # rows = y cells, cols = x cells
    assert res.is_ground.shape == (3,)


def test_reports_monotonic_progress_ending_at_one():
    x, y, z, _ = _scene()
    calls = []
    extract_ground(x, y, z, GroundParams(), lambda f, m: calls.append((f, m)))
    fractions = [f for f, _ in calls]
    assert fractions == sorted(fractions)
    assert fractions[-1] == 1.0
    assert all(isinstance(m, str) and m for _, m in calls)


def test_empty_raises():
    e = np.array([])
    with pytest.raises(ValueError):
        extract_ground(e, e, e, GroundParams())


def test_oversized_raster_raises():
    x = np.array([0.0, 20_000.0])
    with pytest.raises(ValueError, match="increase cell_size"):
        extract_ground(x, x, np.zeros(2), GroundParams(cell_size=0.1))


@pytest.mark.parametrize("max_window,cell", [(30, 1.0), (5, 1.0), (100, 0.5), (1, 1.0)])
def test_window_sizes_are_odd_increasing_and_capped(max_window, cell):
    sizes = _window_sizes(max_window, cell)
    assert sizes[0] == 3 or len(sizes) == 1
    assert all(s % 2 == 1 for s in sizes)
    assert sizes == sorted(set(sizes))
    assert sizes[-1] == max(3, int(round(max_window / cell)) | 1)
