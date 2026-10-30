# laz-viewer backend

FastAPI service that extracts the ground surface from LAS/LAZ point clouds.
Used by the viewer in `../frontend`, but it is a standalone HTTP API.

## Stack

- FastAPI + uvicorn
- laspy (with lazrs for LAZ) for reading/writing point clouds
- numpy + scipy for the ground filter

## Layout

```
app/main.py     HTTP routes, upload validation, CORS
app/jobs.py     in-memory job store, background worker threads, output writing
app/ground.py   progressive morphological ground filter (pure numpy/scipy, no I/O)
tests/          algorithm and API tests
```

## Run

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload      # http://localhost:8000/docs
```

Or with Docker: `docker build -t laz-ground-api . && docker run -p 8000:8000 laz-ground-api`
(or `docker compose up` from the repo root).

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | liveness check |
| POST | `/api/ground-jobs` | multipart `file` (.las/.laz) + parameters; returns `202 {id}` |
| GET | `/api/ground-jobs/{id}` | `status` (queued/running/done/error), `progress` 0-1, `message`, `error`, `stats` |
| GET | `/api/ground-jobs/{id}/ground.las` | ground points, classification 2 |
| GET | `/api/ground-jobs/{id}/nonground.las` | everything else |
| DELETE | `/api/ground-jobs/{id}` | delete job and files |

Example:

```bash
id=$(curl -s -F file=@scan.laz -F cell_size=1 localhost:8000/api/ground-jobs | jq -r .id)
curl -s localhost:8000/api/ground-jobs/$id
curl -o ground.las localhost:8000/api/ground-jobs/$id/ground.las
```

### Parameters (form fields, all optional)

| Name | Default | Meaning |
| --- | --- | --- |
| `cell_size` | 1.0 m | Raster resolution. Larger is faster but coarser. |
| `max_window` | 30 m | Largest object (e.g. building) to remove. |
| `slope` | 0.15 | Terrain slope (rise/run) tolerated; raise for steep terrain. |
| `initial_threshold` | 0.3 m | Height difference marking an object at the smallest window. |
| `max_threshold` | 3.0 m | Cap on the height-difference threshold. |
| `point_threshold` | 0.3 m | Max height above the surface for a point to be ground. |

## Algorithm

Progressive morphological filter (Zhang et al. 2003): rasterise the minimum Z per cell,
fill gaps with nearest values, then apply grey openings with growing windows. Cells that an
opening lowers by more than a slope-scaled threshold are objects; the opened value replaces
them. Points within `point_threshold` of the final bilinear-sampled surface are ground.

## Notes and limits

- Jobs live in memory and files in the system temp dir (`laz-ground-jobs`); a restart loses
  jobs, and nothing is deleted automatically except via `DELETE`.
- At most 2 jobs run at once. Each loads the whole file into memory; uploads are capped at 2 GiB.
- Output is uncompressed `.las` in the input's LAS version and point format.
- Allowed CORS origins are the Vite dev servers (`app/main.py`); the Docker setup avoids CORS by proxying through nginx.

## Tests

```bash
.venv/bin/python -m pytest
```
