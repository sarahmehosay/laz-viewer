import time

import laspy
import numpy as np
from fastapi.testclient import TestClient

from app.main import app


def _las_bytes(tmp_path):
    rng = np.random.default_rng(1)
    n = 20_000
    las = laspy.create(point_format=3, file_version="1.2")
    las.x, las.y = rng.uniform(0, 50, n), rng.uniform(0, 50, n)
    z = np.zeros(n)
    z[(las.x > 20) & (las.x < 30) & (las.y > 20) & (las.y < 30)] = 6
    las.z = z
    p = tmp_path / "t.las"
    las.write(p)
    return p.read_bytes()


def test_job_roundtrip(tmp_path):
    c = TestClient(app)
    r = c.post("/api/ground-jobs", files={"file": ("t.las", _las_bytes(tmp_path))})
    assert r.status_code == 202
    jid = r.json()["id"]
    for _ in range(50):
        s = c.get(f"/api/ground-jobs/{jid}").json()
        if s["status"] in ("done", "error"):
            break
        time.sleep(0.1)
    assert s["status"] == "done", s
    assert 0.8 < s["stats"]["ground_ratio"] < 1.0
    out = c.get(f"/api/ground-jobs/{jid}/ground.las")
    assert out.content[:4] == b"LASF"
    assert c.delete(f"/api/ground-jobs/{jid}").status_code == 204


def test_rejects_bad_extension():
    r = TestClient(app).post("/api/ground-jobs", files={"file": ("a.txt", b"x")})
    assert r.status_code == 400
