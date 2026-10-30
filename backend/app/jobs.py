"""In-memory job store; one worker thread per job. Swap for a queue if you scale out."""
import shutil
import tempfile
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import laspy
import numpy as np

from .ground import GroundParams, extract_ground

WORK_DIR = Path(tempfile.gettempdir()) / "laz-ground-jobs"
_slots = threading.Semaphore(2)  # limit concurrent jobs (memory-bound)


@dataclass
class Job:
    id: str
    dir: Path
    status: str = "queued"          # queued | running | done | error
    progress: float = 0.0
    message: str = ""
    error: str | None = None
    stats: dict = field(default_factory=dict)


JOBS: dict[str, Job] = {}


def create_job(upload_path_writer, params: GroundParams, filename: str) -> Job:
    job_id = uuid.uuid4().hex
    job_dir = WORK_DIR / job_id
    job_dir.mkdir(parents=True)
    suffix = Path(filename).suffix.lower()
    src = job_dir / f"input{suffix}"
    upload_path_writer(src)
    job = Job(id=job_id, dir=job_dir)
    JOBS[job_id] = job
    threading.Thread(target=_run, args=(job, src, params), daemon=True).start()
    return job


def delete_job(job_id: str) -> bool:
    job = JOBS.pop(job_id, None)
    if job:
        shutil.rmtree(job.dir, ignore_errors=True)
    return job is not None


def _run(job: Job, src: Path, params: GroundParams) -> None:
    with _slots:
        try:
            job.status = "running"

            def progress(f, m):
                job.progress, job.message = f * 0.9, m

            las = laspy.read(src)
            x, y, z = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)
            result = extract_ground(x, y, z, params, progress)

            job.message = "Writing output"
            ground = laspy.LasData(las.header)
            ground.points = las.points[result.is_ground]
            ground.classification = np.full(int(result.is_ground.sum()), 2, dtype=np.uint8)
            ground.write(job.dir / "ground.las")
            rest = laspy.LasData(las.header)
            rest.points = las.points[~result.is_ground]
            rest.write(job.dir / "nonground.las")

            n_ground = int(result.is_ground.sum())
            job.stats = {
                "total_points": len(x),
                "ground_points": n_ground,
                "nonground_points": len(x) - n_ground,
                "ground_ratio": n_ground / len(x),
                "dem_shape": list(result.dem.shape),
            }
            job.progress, job.status, job.message = 1.0, "done", "Done"
        except Exception as exc:  # surfaced to the UI
            job.status, job.error = "error", str(exc)
