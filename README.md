# laz-viewer

LAS/LAZ point cloud viewer with server-side ground surface extraction.

```
frontend/   Vue 3 + Vite + CesiumJS viewer and the "Ground extraction" panel
backend/    FastAPI service (laspy + numpy + scipy) that classifies ground points
```

The two folders are independent (own dependencies, own `.gitignore`) and talk only
over HTTP under `/api`, so either can be split out or deployed separately.

## Run (development)

```bash
# terminal 1 - backend on :8000
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload

# terminal 2 - frontend on :5173 (proxies /api -> :8000)
cd frontend
npm install
npm run dev
```

Set `VITE_API_TARGET` (dev proxy) or `VITE_API_BASE` (built app) to point the frontend at a different backend.

## Run (Docker)

```bash
docker compose up --build   # open http://localhost:8080
```

nginx serves the built frontend and proxies `/api` to the backend container, so no CORS
setup is needed. Job files live in the `ground-jobs` volume.

## Deploy (GitHub Pages)

`.github/workflows/deploy-pages.yml` builds `frontend/` and publishes it on every push to
`main` that touches `frontend/` (or run it manually from the Actions tab).

1. Repo **Settings → Pages → Source: GitHub Actions**.
2. Optional, for ground extraction: deploy `backend/` somewhere public, start it with
   `CORS_ORIGINS=https://<owner>.github.io`, and set the repo variable
   **Settings → Secrets and variables → Actions → Variables → `VITE_API_BASE`** to its URL
   (e.g. `https://laz-api.example.com`, no trailing slash).

Pages only hosts static files, so without a backend the viewer still works but
**Extract ground** will fail.

## Ground extraction

1. Drop a `.las`/`.laz` file in the viewer.
2. Open **Ground extraction**, tune parameters if needed, click **Extract ground**.
3. The file is uploaded, a job runs in the backend, and progress is polled.
4. When done, switch between Original / Ground / Non-ground, or download the `.las` results
   (ground points carry ASPRS classification 2).

### API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/ground-jobs` | multipart `file` + params; returns `{id}` |
| GET | `/api/ground-jobs/{id}` | status, progress, stats |
| GET | `/api/ground-jobs/{id}/ground.las` | ground points (also `nonground.las`) |
| DELETE | `/api/ground-jobs/{id}` | remove job and files |

### Algorithm

Progressive morphological filter (Zhang et al. 2003): build a minimum-Z raster, apply grey
openings with growing windows, and treat cells the opening lowers by more than a slope-scaled
threshold as objects (buildings, trees). Points within `point_threshold` of the resulting
surface are ground. Parameters: `cell_size`, `max_window`, `slope`, `initial_threshold`,
`max_threshold`, `point_threshold`.

### Tests

```bash
cd backend && .venv/bin/python -m pytest
```

See `backend/README.md` and `frontend/README.md` for per-folder details.
