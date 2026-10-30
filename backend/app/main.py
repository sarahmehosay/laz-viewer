from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import jobs
from .ground import GroundParams

MAX_UPLOAD_BYTES = 2 * 1024**3

app = FastAPI(title="LAZ ground extraction API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/ground-jobs", status_code=202)
def create_ground_job(
    file: UploadFile = File(...),
    cell_size: float = Form(1.0, gt=0.05, le=50),
    max_window: float = Form(30.0, gt=1, le=500),
    slope: float = Form(0.15, ge=0, le=2),
    initial_threshold: float = Form(0.3, ge=0, le=5),
    max_threshold: float = Form(3.0, gt=0, le=50),
    point_threshold: float = Form(0.3, ge=0, le=5),
):
    name = file.filename or "input.las"
    if Path(name).suffix.lower() not in (".las", ".laz"):
        raise HTTPException(400, "Only .las / .laz files are supported.")
    params = GroundParams(cell_size, max_window, slope, initial_threshold, max_threshold, point_threshold)

    def write(dest: Path):
        size = 0
        with open(dest, "wb") as f:
            while chunk := file.file.read(1 << 20):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "File too large.")
                f.write(chunk)

    job = jobs.create_job(write, params, name)
    return {"id": job.id}


def _get(job_id: str) -> jobs.Job:
    job = jobs.JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job.")
    return job


@app.get("/api/ground-jobs/{job_id}")
def job_status(job_id: str):
    j = _get(job_id)
    return {"id": j.id, "status": j.status, "progress": j.progress,
            "message": j.message, "error": j.error, "stats": j.stats}


@app.get("/api/ground-jobs/{job_id}/{kind}.las")
def job_result(job_id: str, kind: str):
    j = _get(job_id)
    if kind not in ("ground", "nonground") or j.status != "done":
        raise HTTPException(404, "Result not available.")
    return FileResponse(j.dir / f"{kind}.las", media_type="application/octet-stream",
                        filename=f"{kind}.las")


@app.delete("/api/ground-jobs/{job_id}", status_code=204)
def remove_job(job_id: str):
    if not jobs.delete_job(job_id):
        raise HTTPException(404, "Unknown job.")
