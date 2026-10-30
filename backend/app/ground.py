"""Ground surface extraction using a progressive morphological filter.

Based on Zhang et al. (2003), "A progressive morphology filter for removing
nonground measurements from airborne LIDAR data". Works on a minimum-elevation
raster, so it runs in seconds on tens of millions of points with numpy/scipy.
"""
from dataclasses import dataclass
from typing import Callable

import numpy as np
from scipy import ndimage


@dataclass
class GroundParams:
    cell_size: float = 1.0          # raster resolution (m)
    max_window: float = 30.0        # largest object (e.g. building) to remove (m)
    slope: float = 0.15             # terrain slope (rise/run) tolerated by the filter
    initial_threshold: float = 0.3  # elevation difference threshold for the first window (m)
    max_threshold: float = 3.0      # cap on the elevation difference threshold (m)
    point_threshold: float = 0.3    # max height above the surface for a point to be ground (m)


@dataclass
class GroundResult:
    is_ground: np.ndarray           # bool per input point
    dem: np.ndarray                 # 2D surface raster, row = y, col = x
    origin: tuple[float, float]     # (min_x, min_y) of dem cell (0, 0) corner
    cell_size: float


Progress = Callable[[float, str], None]


def _fill_nans(grid: np.ndarray) -> np.ndarray:
    mask = np.isnan(grid)
    if not mask.any():
        return grid
    idx = ndimage.distance_transform_edt(mask, return_distances=False, return_indices=True)
    return grid[tuple(idx)]


def _window_sizes(max_window: float, cell: float) -> list[int]:
    """Odd window sizes in cells, growing geometrically up to max_window."""
    max_cells = max(3, int(round(max_window / cell)) | 1)
    sizes, w = [], 3
    while w < max_cells:
        sizes.append(w)
        w = int(w * 1.6) | 1
    sizes.append(max_cells)
    return sizes


def extract_ground(
    x: np.ndarray, y: np.ndarray, z: np.ndarray,
    params: GroundParams, progress: Progress = lambda f, m: None,
) -> GroundResult:
    if len(x) == 0:
        raise ValueError("Point cloud is empty.")
    cell = params.cell_size
    min_x, min_y = float(x.min()), float(y.min())
    cols = int((x.max() - min_x) // cell) + 1
    rows = int((y.max() - min_y) // cell) + 1
    if rows * cols > 100_000_000:
        raise ValueError(f"Raster would be {cols}x{rows} cells; increase cell_size.")

    progress(0.05, "Building minimum-elevation raster")
    ci = ((x - min_x) // cell).astype(np.int64)
    ri = ((y - min_y) // cell).astype(np.int64)
    flat = ri * cols + ci
    zmin = np.full(rows * cols, np.inf)
    np.minimum.at(zmin, flat, z)
    zmin[np.isinf(zmin)] = np.nan
    surface = _fill_nans(zmin.reshape(rows, cols))

    # Progressive opening: each pass removes objects up to the window size.
    sizes = _window_sizes(params.max_window, cell)
    prev = 1
    for n, w in enumerate(sizes):
        progress(0.15 + 0.6 * n / len(sizes), f"Morphological opening, window {w * cell:.1f} m")
        opened = ndimage.grey_opening(surface, size=(w, w))
        dh = min(params.max_threshold,
                 params.initial_threshold + params.slope * (w - prev) * cell)
        # Cells where the opening lowered the surface by more than dh are
        # objects: keep the lowered value; otherwise keep the original terrain.
        surface = np.where(surface - opened > dh, opened, surface)
        prev = w
    # Smooth out the stair-stepping from the grid.
    surface = ndimage.uniform_filter(surface, size=3, mode="nearest")

    progress(0.8, "Classifying points")
    # Bilinear sample at cell centres.
    fx = (x - min_x) / cell - 0.5
    fy = (y - min_y) / cell - 0.5
    surf_at = ndimage.map_coordinates(surface, [fy, fx], order=1, mode="nearest")
    is_ground = (z - surf_at) <= params.point_threshold
    progress(1.0, "Done")
    return GroundResult(is_ground, surface, (min_x, min_y), cell)
