"""Regenerates the LAS/LAZ fixtures used by src/lib/las.test.js.

Run from the repo root with the backend venv (laspy + lazrs):
    backend/.venv/bin/python frontend/src/lib/testing/fixtures/make_fixtures.py
"""
from pathlib import Path

import laspy
import numpy as np

OUT = Path(__file__).parent
N = 100

# (file name, LAS version, point format, compressed)
FIXTURES = [
    ("v12-fmt3.laz", "1.2", 3, True),
    ("v14-fmt6.las", "1.4", 6, False),
    ("v14-fmt6.laz", "1.4", 6, True),
    ("v14-fmt7.laz", "1.4", 7, True),
    ("v14-fmt8.laz", "1.4", 8, True),
]

for name, version, fmt, compressed in FIXTURES:
    las = laspy.create(point_format=fmt, file_version=version)
    las.header.scales = [0.01, 0.01, 0.01]
    las.header.offsets = [1000, 2000, 0]
    i = np.arange(N)
    # Point i sits at (1000 + i, 2000 + 2i, i / 10) so tests can check exact values.
    las.x, las.y, las.z = 1000 + i, 2000 + 2 * i, i / 10
    las.classification = np.full(N, 2, dtype=np.uint8)
    if "red" in las.point_format.dimension_names:
        # 16-bit colour, as most writers produce: point i is (i*600, 0, 65535 - i*600).
        las.red, las.green, las.blue = i * 600, np.zeros(N), 65535 - i * 600
    las.write(OUT / name, do_compress=compressed)
    print(name, laspy.read(OUT / name).header.point_count)

# RGB fields present but every point the same colour (scanners without a camera).
for name, value in [("v12-fmt2-black.laz", 0), ("v14-fmt7-white.laz", 255)]:
    fmt, version = (2, "1.2") if "fmt2" in name else (7, "1.4")
    las = laspy.create(point_format=fmt, file_version=version)
    las.header.scales = [0.01, 0.01, 0.01]
    i = np.arange(N)
    las.x, las.y, las.z = i, i, i / 10
    las.red = las.green = las.blue = np.full(N, value)
    las.write(OUT / name, do_compress=True)
    print(name, value)
