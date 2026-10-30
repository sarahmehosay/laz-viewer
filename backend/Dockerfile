FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

# Run unprivileged; job files go to the temp dir (mount a volume there if needed)
RUN useradd -r -u 10001 appuser && mkdir -p /tmp/laz-ground-jobs && chown appuser /tmp/laz-ground-jobs
USER appuser

EXPOSE 8000
HEALTHCHECK CMD python -c "import urllib.request as u; u.urlopen('http://localhost:8000/api/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
