"""FastAPI app: coach→client training API plus the static frontend.

Routes under ``/api`` return JSON; everything else is served from the repo
root as static files so ``index.html`` / ``app.js`` / ``styles.css`` load
from the same origin (no CORS, no second server).
"""

from datetime import date, datetime, timedelta

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .db import ROOT, connect, init_schema
from .seed import seed

app = FastAPI(title="Coach to Client — 100 km")


@app.on_event("startup")
def _startup() -> None:
    init_schema()
    seed()


def _row(table_one_row: str):
    with connect() as conn:
        row = conn.execute(f"SELECT * FROM {table_one_row} WHERE id = 1").fetchone()
    return dict(row) if row else None


@app.get("/api/coach")
def get_coach():
    coach = _row("coach")
    if not coach:
        raise HTTPException(404, "coach not seeded")
    return coach


@app.get("/api/client")
def get_client():
    client = _row("client")
    if not client:
        raise HTTPException(404, "client not seeded")
    event = datetime.strptime(client["event_date"], "%Y-%m-%d").date()
    client["days_to_event"] = (event - date.today()).days
    return client


def _plan_rows(conn) -> list[dict]:
    rows = conn.execute(
        """
        SELECT s.*, l.done, l.completed_km, l.readiness, l.notes
        FROM sessions s
        LEFT JOIN session_log l ON l.date = s.date
        ORDER BY s.date
        """
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["done"] = bool(d["done"])
        d["readiness"] = d["readiness"] or "green"
        d["notes"] = d["notes"] or ""
        out.append(d)
    return out


@app.get("/api/plan")
def get_plan():
    with connect() as conn:
        return _plan_rows(conn)


@app.get("/api/week/{week}")
def get_week(week: int):
    with connect() as conn:
        briefing = conn.execute(
            "SELECT * FROM week_briefings WHERE week = ?", (week,)
        ).fetchone()
        sessions = [r for r in _plan_rows(conn) if r["week"] == week]
    if not briefing:
        raise HTTPException(404, "no such week")
    planned = sum(s["distance_km"] or 0 for s in sessions)
    completed = sum(
        (s["completed_km"] if s["completed_km"] is not None else s["distance_km"]) or 0
        for s in sessions
        if s["done"]
    )
    return {
        "briefing": dict(briefing),
        "sessions": sessions,
        "planned_km": round(planned, 1),
        "completed_km": round(completed, 1),
    }


class LogIn(BaseModel):
    done: bool = False
    completed_km: float | None = None
    readiness: str = "green"
    notes: str = ""


@app.post("/api/log/{log_date}")
def upsert_log(log_date: str, body: LogIn):
    if body.readiness not in {"green", "yellow", "red"}:
        raise HTTPException(400, "readiness must be green, yellow, or red")
    with connect() as conn:
        exists = conn.execute(
            "SELECT 1 FROM sessions WHERE date = ?", (log_date,)
        ).fetchone()
        if not exists:
            raise HTTPException(404, "no session on that date")
        conn.execute(
            """
            INSERT INTO session_log (date, done, completed_km, readiness, notes, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(date) DO UPDATE SET
                done = excluded.done,
                completed_km = excluded.completed_km,
                readiness = excluded.readiness,
                notes = excluded.notes,
                updated_at = excluded.updated_at
            """,
            (log_date, int(body.done), body.completed_km, body.readiness, body.notes),
        )
        row = conn.execute(
            "SELECT * FROM session_log WHERE date = ?", (log_date,)
        ).fetchone()
    return dict(row)


def _completed_value(s: dict) -> float:
    if not s["done"]:
        return 0.0
    if s["completed_km"] is not None:
        return s["completed_km"]
    return s["distance_km"] or 0.0


@app.get("/api/progress")
def get_progress():
    today = date.today().isoformat()
    with connect() as conn:
        plan = _plan_rows(conn)

    total_planned = sum(s["distance_km"] or 0 for s in plan)
    total_completed = sum(_completed_value(s) for s in plan)

    to_date = [s for s in plan if s["date"] <= today]
    planned_to_date = sum(s["distance_km"] or 0 for s in to_date)
    completed_to_date = sum(_completed_value(s) for s in to_date)
    adherence = round(100 * completed_to_date / planned_to_date) if planned_to_date else 0

    # Current week = week of today's session, else latest week already started.
    current_week = 1
    for s in plan:
        if s["date"] <= today:
            current_week = s["week"]
        else:
            break
    week_sessions = [s for s in plan if s["week"] == current_week]
    week_planned = sum(s["distance_km"] or 0 for s in week_sessions)
    week_completed = sum(_completed_value(s) for s in week_sessions)

    longest = max((_completed_value(s) for s in plan), default=0.0)

    # Biggest back-to-back: two consecutive calendar days, both logged done.
    done_km = {s["date"]: _completed_value(s) for s in plan if s["done"]}
    back_to_back = 0.0
    for ds, km in done_km.items():
        nxt = (date.fromisoformat(ds) + timedelta(days=1)).isoformat()
        if nxt in done_km:
            back_to_back = max(back_to_back, km + done_km[nxt])

    return {
        "total_planned_km": round(total_planned, 1),
        "total_completed_km": round(total_completed, 1),
        "adherence_pct": adherence,
        "current_week": current_week,
        "week_planned_km": round(week_planned, 1),
        "week_completed_km": round(week_completed, 1),
        "longest_km": round(longest, 1),
        "back_to_back_km": round(back_to_back, 1),
    }


# Static frontend, mounted last so /api/* wins. html=True serves index.html at /.
app.mount("/", StaticFiles(directory=ROOT, html=True), name="static")
