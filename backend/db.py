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

CREATE TABLE IF NOT EXISTS users (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS session_log (
    user_id      INTEGER NOT NULL REFERENCES users(id),
    date         TEXT NOT NULL REFERENCES sessions(date),
    done         INTEGER NOT NULL DEFAULT 0,
    completed_km REAL,
    readiness    TEXT NOT NULL DEFAULT 'green',
    notes        TEXT NOT NULL DEFAULT '',
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, date)
);

-- The kit list itself is shared content; checked/tested state is per user.
CREATE TABLE IF NOT EXISTS kit_items (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    label    TEXT NOT NULL,
    category TEXT NOT NULL,
    sort     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kit_state (
    user_id INTEGER NOT NULL REFERENCES users(id),
    item_id INTEGER NOT NULL REFERENCES kit_items(id),
    checked INTEGER NOT NULL DEFAULT 0,
    tested  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, item_id)
);
"""


def connect() -> sqlite3.Connection:
    """Open a connection with row access by column name and FK enforcement."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _legacy_owner_email() -> str:
    """Who owns data written before tables were per-user: the first allowed
    email in production, or the fixed dev user locally."""
    emails = [
        e.strip().lower()
        for e in os.environ.get("ALLOWED_EMAILS", "").split(",")
        if e.strip()
    ]
    return emails[0] if emails else "dev@local"


def _migrate_single_user(conn: sqlite3.Connection) -> None:
    """Rebuild pre-multi-user tables, assigning existing rows to the legacy
    owner. Old ``session_log`` had no user_id; old ``kit_items`` carried
    checked/tested inline instead of in ``kit_state``."""
    old_log = "user_id" not in _columns(conn, "session_log")
    old_kit = "checked" in _columns(conn, "kit_items")
    if not (old_log or old_kit):
        return

    conn.execute(
        "INSERT OR IGNORE INTO users (email) VALUES (?)", (_legacy_owner_email(),)
    )
    owner = conn.execute(
        "SELECT id FROM users WHERE email = ?", (_legacy_owner_email(),)
    ).fetchone()[0]

    if old_log:
        conn.executescript(
            """
            ALTER TABLE session_log RENAME TO session_log_legacy;
            CREATE TABLE session_log (
                user_id      INTEGER NOT NULL REFERENCES users(id),
                date         TEXT NOT NULL REFERENCES sessions(date),
                done         INTEGER NOT NULL DEFAULT 0,
                completed_km REAL,
                readiness    TEXT NOT NULL DEFAULT 'green',
                notes        TEXT NOT NULL DEFAULT '',
                updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (user_id, date)
            );
            """
        )
        conn.execute(
            """
            INSERT INTO session_log
                (user_id, date, done, completed_km, readiness, notes, updated_at)
            SELECT ?, date, done, completed_km, readiness, notes, updated_at
            FROM session_log_legacy
            """,
            (owner,),
        )
        conn.execute("DROP TABLE session_log_legacy")

    if old_kit:
        conn.execute(
            """
            INSERT INTO kit_state (user_id, item_id, checked, tested)
            SELECT ?, id, checked, tested FROM kit_items
            WHERE checked != 0 OR tested != 0
            """,
            (owner,),
        )
        # DROP COLUMN (not a table rebuild) so kit_state's FK, which already
        # points at this table, is left untouched.
        conn.execute("ALTER TABLE kit_items DROP COLUMN checked")
        conn.execute("ALTER TABLE kit_items DROP COLUMN tested")


def init_schema() -> None:
    """Create tables if they do not yet exist, then upgrade any pre-multi-user
    database in place (existing data goes to the legacy owner)."""
    with connect() as conn:
        # users/kit_state must exist before the migration can reference them;
        # IF NOT EXISTS leaves old-shape tables alone for the migration to fix.
        conn.executescript(SCHEMA)
        conn.execute("PRAGMA foreign_keys = OFF")
        _migrate_single_user(conn)
        conn.execute("PRAGMA foreign_keys = ON")
