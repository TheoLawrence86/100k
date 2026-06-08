"""SQLite access for the coaching app.

A single connection-per-request helper plus schema creation. The database
file lives at ``DB_PATH`` (default ``data/coach.db``); the directory is
created if needed so the app works both locally and inside a container
whose data directory is a fresh volume mount.
"""

import os
import sqlite3
from pathlib import Path

# Repo root = parent of this backend/ package.
ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("DB_PATH", ROOT / "data" / "coach.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS coach (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    name       TEXT NOT NULL,
    title      TEXT NOT NULL,
    bio        TEXT NOT NULL,
    philosophy TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS client (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    name       TEXT NOT NULL,
    event      TEXT NOT NULL,
    event_date TEXT NOT NULL,
    start_date TEXT NOT NULL,
    target     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    date        TEXT PRIMARY KEY,
    day         TEXT,
    week        INTEGER,
    phase       TEXT,
    distance_km REAL,
    type        TEXT,
    session     TEXT,
    duration    TEXT,
    equipment   TEXT,
    fuel        TEXT,
    coach_note  TEXT
);

CREATE TABLE IF NOT EXISTS week_briefings (
    week      INTEGER PRIMARY KEY,
    target_km REAL,
    focus     TEXT,
    briefing  TEXT
);

CREATE TABLE IF NOT EXISTS session_log (
    date         TEXT PRIMARY KEY REFERENCES sessions(date),
    done         INTEGER NOT NULL DEFAULT 0,
    completed_km REAL,
    readiness    TEXT NOT NULL DEFAULT 'green',
    notes        TEXT NOT NULL DEFAULT '',
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def connect() -> sqlite3.Connection:
    """Open a connection with row access by column name and FK enforcement."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_schema() -> None:
    """Create tables if they do not yet exist."""
    with connect() as conn:
        conn.executescript(SCHEMA)
