FROM python:3.12-slim

WORKDIR /app

# Dependencies first for layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code and static frontend.
COPY backend/ ./backend/
COPY data/ ./data/
COPY docs/ ./docs/
COPY index.html app.js styles.css ./

# SQLite lives here; docker-compose mounts a volume over it so data persists.
ENV DB_PATH=/app/dbdata/coach.db

EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
