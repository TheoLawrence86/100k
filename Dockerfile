FROM python:3.12-slim

WORKDIR /app

# Dependencies first for layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code and static frontend.
COPY backend/ ./backend/
COPY data/ ./data/
COPY docs/ ./docs/
COPY index.html styles.css manifest.webmanifest sw.js ./
COPY js/ ./js/
COPY assets/ ./assets/

# SQLite lives here; docker-compose mounts a volume over it so data persists.
ENV DB_PATH=/app/dbdata/coach.db

# Commit the image was built from, surfaced at /api/version. Defaults to "dev"
# for local builds; CI passes the real git sha via --build-arg GIT_SHA=...
ARG GIT_SHA=dev
ENV APP_VERSION=${GIT_SHA}

EXPOSE 8000
# Long keep-alive: Chrome reuses pooled connections, and uvicorn's 5 s
# default closes them mid-reuse, surfacing as "Failed to fetch" in the app.
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-keep-alive", "75"]
