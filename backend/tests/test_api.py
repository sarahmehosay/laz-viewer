import importlib
import time

import laspy
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import jobs, main
from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def _las_bytes(tmp_path, point_format=3, version="1.2", compress=False):
    rng = np.random.default_rng(1)
    n = 20_000
    las = laspy.create(point_format=point_format, file_version=version)
    las.x, las.y = rng.uniform(0, 50, n), rng.uniform(0, 50, n)
    z = np.zeros(n)
    z[(las.x > 20) & (las.x < 30) & (las.y > 20) & (las.y < 30)] = 6
    las.z = z
    p = tmp_path / ("t.laz" if compress else "t.las")
    las.write(p, do_compress=compress)
    return p.read_bytes()


def _wait(c, jid):
    for _ in range(50):
        s = c.get(f"/api/ground-jobs/{jid}").json()
        if s["status"] in ("done", "error"):
            return s
        time.sleep(0.1)
    raise AssertionError(f"job {jid} did not finish: {s}")


def test_health(client):
    assert client.get("/api/health").json() == {"ok": True}


def test_job_roundtrip(client, tmp_path):
    r = client.post("/api/ground-jobs", files={"file": ("t.las", _las_bytes(tmp_path))})
    assert r.status_code == 202
    jid = r.json()["id"]
    s = _wait(client, jid)
    assert s["status"] == "done", s
    assert s["progress"] == 1.0
    assert 0.8 < s["stats"]["ground_ratio"] < 1.0
    out = client.get(f"/api/ground-jobs/{jid}/ground.las")
    assert out.content[:4] == b"LASF"
    assert client.delete(f"/api/ground-jobs/{jid}").status_code == 204
    assert client.get(f"/api/ground-jobs/{jid}").status_code == 404


def test_results_split_points_and_classify_ground(client, tmp_path):
    jid = client.post("/api/ground-jobs", files={"file": ("t.las", _las_bytes(tmp_path))}).json()["id"]
    stats = _wait(client, jid)["stats"]
    for kind in ("ground", "nonground"):
        (tmp_path / f"{kind}.las").write_bytes(client.get(f"/api/ground-jobs/{jid}/{kind}.las").content)
    ground = laspy.read(tmp_path / "ground.las")
    rest = laspy.read(tmp_path / "nonground.las")
    assert len(ground.points) == stats["ground_points"]
    assert len(rest.points) == stats["nonground_points"]
    assert len(ground.points) + len(rest.points) == stats["total_points"] == 20_000
    assert (np.asarray(ground.classification) == 2).all()
    assert (np.asarray(rest.z) > 5).all()  # only the raised block is non-ground
    client.delete(f"/api/ground-jobs/{jid}")


@pytest.mark.parametrize("point_format", [6, 7, 8])
def test_laz_14_roundtrip(client, tmp_path, point_format):
    data = _las_bytes(tmp_path, point_format=point_format, version="1.4", compress=True)
    jid = client.post("/api/ground-jobs", files={"file": ("t.laz", data)}).json()["id"]
    s = _wait(client, jid)
    assert s["status"] == "done", s
    (tmp_path / "g.las").write_bytes(client.get(f"/api/ground-jobs/{jid}/ground.las").content)
    ground = laspy.read(tmp_path / "g.las")
    assert ground.header.version == laspy.header.Version(1, 4)
    assert ground.header.point_format.id == point_format
    assert len(ground.points) == s["stats"]["ground_points"]
    assert (np.asarray(ground.classification) == 2).all()
    client.delete(f"/api/ground-jobs/{jid}")


def test_rejects_bad_extension(client):
    r = client.post("/api/ground-jobs", files={"file": ("a.txt", b"x")})
    assert r.status_code == 400


@pytest.mark.parametrize("field,value", [("cell_size", "0"), ("slope", "-1"), ("max_window", "1000")])
def test_rejects_out_of_range_params(client, field, value):
    r = client.post("/api/ground-jobs", files={"file": ("a.las", b"x")}, data={field: value})
    assert r.status_code == 422


def test_invalid_las_content_reports_job_error(client):
    jid = client.post("/api/ground-jobs", files={"file": ("bad.las", b"not a las file")}).json()["id"]
    s = _wait(client, jid)
    assert s["status"] == "error"
    assert s["error"]
    assert client.get(f"/api/ground-jobs/{jid}/ground.las").status_code == 404
    client.delete(f"/api/ground-jobs/{jid}")


def test_unknown_job_returns_404(client):
    assert client.get("/api/ground-jobs/nope").status_code == 404
    assert client.get("/api/ground-jobs/nope/ground.las").status_code == 404
    assert client.delete("/api/ground-jobs/nope").status_code == 404


def test_result_unavailable_until_done_or_for_unknown_kind(client, tmp_path):
    jobs.JOBS["pending"] = jobs.Job(id="pending", dir=tmp_path, status="running")
    try:
        assert client.get("/api/ground-jobs/pending/ground.las").status_code == 404
        jobs.JOBS["pending"].status = "done"
        assert client.get("/api/ground-jobs/pending/input.las").status_code == 404
    finally:
        jobs.JOBS.pop("pending")


def test_cors_origins_from_env(monkeypatch):
    origin = "https://someone.github.io"
    monkeypatch.setenv("CORS_ORIGINS", f" {origin} , ")
    try:
        reloaded = importlib.reload(main)
        assert reloaded.EXTRA_ORIGINS == [origin]
        r = TestClient(reloaded.app).options(
            "/api/health", headers={"Origin": origin, "Access-Control-Request-Method": "GET"}
        )
        assert r.headers["access-control-allow-origin"] == origin
    finally:
        monkeypatch.delenv("CORS_ORIGINS")
        importlib.reload(main)
