"""Regenerates the LAS/LAZ fixtures used by src/lib/las.test.js.

Run from the repo root with the backend venv (laspy + lazrs):
    backend/.venv/bin/python frontend/src/lib/testing/fixtures/make_fixtures.py
"""
from pathlib import Path

import laspy
from laspy.vlrs.vlrlist import VLRList
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

# CRS records. Points sit around (15000, -131000) m, which in JGD2011 / Japan
# Plane Rectangular CS VII (EPSG:6675) is Toyokawa, Aichi (~34.82 N, 137.33 E).
ALBERS_WKT = (
    'COMPD_CS["NAD83(2011) / Conus Albers + NAVD88 height (ftUS)",PROJCS["NAD83(2011) / Conus Albers",'
    'GEOGCS["NAD83(2011)",DATUM["NAD83_National_Spatial_Reference_System_2011",SPHEROID["GRS 1980",6378137,'
    '298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],'
    'PROJECTION["Albers_Conic_Equal_Area"],PARAMETER["standard_parallel_1",29.5],'
    'PARAMETER["standard_parallel_2",45.5],PARAMETER["latitude_of_center",23],'
    'PARAMETER["longitude_of_center",-96],PARAMETER["false_easting",0],PARAMETER["false_northing",0],'
    'UNIT["metre",1],AXIS["X",EAST],AXIS["Y",NORTH],AUTHORITY["EPSG","6350"]],'
    'VERT_CS["NAVD88 height (ftUS)",VERT_DATUM["North American Vertical Datum 1988",2005],'
    'UNIT["US survey foot",0.304800609601219],AXIS["Gravity-related height",UP]]]'
)


def geokeys(*keys):
    """GeoKeyDirectory record: header + (key id, location 0, count 1, value) entries."""
    import struct
    data = struct.pack("<4H", 1, 1, 0, len(keys))
    for key, value in keys:
        data += struct.pack("<4H", key, 0, 1, value)
    return data


def crs_fixture(name, version, fmt, vlrs=(), evlrs=(), xy=(15000.0, -131000.0)):
    las = laspy.create(point_format=fmt, file_version=version)
    las.header.scales = [0.01, 0.01, 0.01]
    las.header.offsets = [xy[0], xy[1], 0]
    i = np.arange(N)
    las.x, las.y, las.z = xy[0] + i, xy[1] + i, 10 + i / 10
    las.vlrs.extend(vlrs)
    if evlrs:
        las.evlrs = VLRList(evlrs)
    if version == "1.4" and (vlrs or evlrs):
        las.header.global_encoding.wkt = True
    las.write(OUT / name, do_compress=True)
    print(name)


crs_fixture("crs-geotiff-6675.laz", "1.2", 3, vlrs=[
    laspy.VLR("LASF_Projection", 34735, record_data=geokeys((1024, 1), (3072, 6675), (3076, 9001), (4099, 9001)))])
crs_fixture("crs-geotiff-6675-usft.laz", "1.2", 3, vlrs=[
    laspy.VLR("LASF_Projection", 34735, record_data=geokeys((1024, 1), (3072, 6675), (3076, 9001), (4099, 9003)))])
crs_fixture("crs-wkt-albers.laz", "1.4", 6, xy=(938500.0, 1376500.0), vlrs=[
    laspy.VLR("LASF_Projection", 2112, record_data=ALBERS_WKT.encode() + b"\0")])
crs_fixture("crs-wkt-evlr-albers.laz", "1.4", 6, xy=(938500.0, 1376500.0), evlrs=[
    laspy.VLR("LASF_Projection", 2112, record_data=ALBERS_WKT.encode() + b"\0")])
