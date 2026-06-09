"""FastAPI app: coach→client training API plus the static frontend.

Routes under ``/api`` return JSON; everything else is served from the repo
root as static files so ``index.html`` / ``app.js`` / ``styles.css`` load
from the same origin (no CORS, no second server).
"""

import os
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .db import ROOT, connect, init_schema
from .seed import seed


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_schema()
    seed()
    yield


app = FastAPI(title="Coach to Client: 100 km", lifespan=lifespan)

# Baked into the image at build time (Dockerfile ARG GIT_SHA); "dev" locally.
APP_VERSION = os.environ.get("APP_VERSION", "dev")

# Full Continuous means running through the night. Fixed event (Henley,
# 12-13 Sep 2026), so the sun times are constants rather than a solar model.
RACE_NIGHT = {
    "sunset": "19:17",
    "sunrise": "06:33",
    "dark_hours": 11.3,
}


@app.get("/api/version")
def get_version():
    """What's actually running — so a stale deploy is obvious at a glance."""
    return {"version": APP_VERSION, "service": "coach-to-client-100k"}


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
    client["night"] = RACE_NIGHT
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


def _daily_done_km(plan: list[dict]) -> dict[str, float]:
    return {s["date"]: _completed_value(s) for s in plan}


def _load_at(done_km: dict[str, float], start: date, day: date) -> dict:
    """Acute (7-day) vs chronic (4-week) load on a given day, in km/week.

    Early in the plan the 28-day window is underfilled, so the chronic sum is
    normalised by the days actually elapsed — otherwise the ratio reads as a
    false alarm for the whole first month.
    """
    acute = sum(
        done_km.get((day - timedelta(days=i)).isoformat(), 0.0) for i in range(7)
    )
    chronic_days = max(7, min((day - start).days + 1, 28))
    chronic_sum = sum(
        done_km.get((day - timedelta(days=i)).isoformat(), 0.0)
        for i in range(chronic_days)
    )
    chronic_weekly = chronic_sum / chronic_days * 7
    ratio = round(acute / chronic_weekly, 2) if chronic_weekly > 0 else None
    return {
        "date": day.isoformat(),
        "acute_km": round(acute, 1),
        "chronic_weekly_km": round(chronic_weekly, 1),
        "ratio": ratio,
    }


@app.get("/api/load")
def get_load():
    """Training-load model + chart series: daily acute/chronic ratio, weekly
    planned-vs-completed, and the cumulative plan-vs-actual lines."""
    today = date.today()
    with connect() as conn:
        plan = _plan_rows(conn)
        briefings = {
            r["week"]: dict(r)
            for r in conn.execute("SELECT * FROM week_briefings").fetchall()
        }
    if not plan:
        raise HTTPException(404, "plan not seeded")

    done_km = _daily_done_km(plan)
    start = date.fromisoformat(plan[0]["date"])
    last = date.fromisoformat(plan[-1]["date"])
    end = min(today, last)

    series = []
    d = start
    while d <= end:
        series.append(_load_at(done_km, start, d))
        d += timedelta(days=1)

    weeks = []
    for week in sorted({s["week"] for s in plan}):
        rows = [s for s in plan if s["week"] == week]
        weeks.append({
            "week": week,
            "start_date": rows[0]["date"],
            "phase": rows[0]["phase"],
            "target_km": (briefings.get(week) or {}).get("target_km"),
            "planned_km": round(sum(s["distance_km"] or 0 for s in rows), 1),
            "completed_km": round(sum(_completed_value(s) for s in rows), 1),
            "is_current": rows[0]["date"] <= today.isoformat() <= rows[-1]["date"],
        })

    cumulative = []
    planned_cum = completed_cum = 0.0
    for s in plan:
        planned_cum += s["distance_km"] or 0
        completed_cum += _completed_value(s)
        cumulative.append({
            "date": s["date"],
            "planned_km": round(planned_cum, 1),
            "completed_km": round(completed_cum, 1) if s["date"] <= today.isoformat() else None,
        })

    return {"series": series, "weeks": weeks, "cumulative": cumulative}


@app.get("/api/brief")
def get_brief(for_date: str | None = None):
    """The coach's generated daily brief: readiness + load ratio + yesterday's
    log + the week focus, folded into one instruction (docs/adaptation-rules.md)."""
    try:
        day = date.fromisoformat(for_date) if for_date else date.today()
    except ValueError:
        raise HTTPException(400, "for_date must be YYYY-MM-DD")

    with connect() as conn:
        plan = _plan_rows(conn)
        briefing = conn.execute(
            "SELECT * FROM week_briefings WHERE week = "
            "(SELECT week FROM sessions WHERE date = ?)",
            (day.isoformat(),),
        ).fetchone()

    row = next((s for s in plan if s["date"] == day.isoformat()), None)
    if not row:
        raise HTTPException(404, "no session on that date")

    start = date.fromisoformat(plan[0]["date"])
    load = _load_at(_daily_done_km(plan), start, day)
    ratio = load["ratio"]
    readiness = row["readiness"] or "green"
    planned = row["distance_km"] or 0

    parts = []
    status = readiness
    if readiness == "red":
        parts.append(
            "Red day: rest and mobility only. Sharp pain, illness, or an altered "
            "gait means we do not run, and we will not cram this session in later."
        )
    elif readiness == "yellow":
        cut = f"{planned * 0.5:.0f}-{planned * 0.7:.0f} km" if planned else "30-50% of the duration"
        parts.append(
            f"Yellow day: cut today back to {cut}, skip any intensity and heavy "
            "strength work, and finish feeling like you could do more."
        )
    else:
        parts.append("Green: do the plan as written.")

    if ratio is not None and readiness != "red":
        if ratio > 1.5:
            status = "yellow" if status == "green" else status
            parts.append(
                f"Heads-up: your 7-day load is {ratio}x your 4-week norm "
                f"({load['acute_km']} km vs {load['chronic_weekly_km']} km/week). "
                "That ramp is steep; keep the effort honest-easy today."
            )
        elif ratio < 0.8 and readiness == "green":
            parts.append(
                f"You're fresh ({load['acute_km']} km in the last 7 days against a "
                f"{load['chronic_weekly_km']} km/week norm); a good day to hit the session properly."
            )

    yesterday = next(
        (s for s in plan if s["date"] == (day - timedelta(days=1)).isoformat()), None
    )
    if yesterday and not yesterday["done"] and (yesterday["distance_km"] or 0) > 0:
        if "long" in (yesterday["type"] or "").lower():
            parts.append(
                "Yesterday's long session wasn't logged. If it didn't happen, we "
                "replace it with 60-90 minutes easy and move on. Never chase missed kilometres."
            )
        else:
            parts.append("Yesterday wasn't logged. If you missed it, skip it; the plan absorbs it.")

    if briefing:
        parts.append(f"This week: {briefing['focus'].lower()}.")

    return {
        "date": day.isoformat(),
        "status": status,
        "readiness": readiness,
        "ratio": ratio,
        "acute_km": load["acute_km"],
        "chronic_weekly_km": load["chronic_weekly_km"],
        "text": " ".join(parts),
    }


class KitIn(BaseModel):
    checked: bool | None = None
    tested: bool | None = None


@app.get("/api/kit")
def get_kit():
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM kit_items ORDER BY sort, id"
        ).fetchall()
    return [
        {**dict(r), "checked": bool(r["checked"]), "tested": bool(r["tested"])}
        for r in rows
    ]


@app.post("/api/kit/{item_id}")
def update_kit(item_id: int, body: KitIn):
    with connect() as conn:
        row = conn.execute("SELECT * FROM kit_items WHERE id = ?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "no such kit item")
        checked = int(body.checked) if body.checked is not None else row["checked"]
        tested = int(body.tested) if body.tested is not None else row["tested"]
        conn.execute(
            "UPDATE kit_items SET checked = ?, tested = ? WHERE id = ?",
            (checked, tested, item_id),
        )
        row = conn.execute("SELECT * FROM kit_items WHERE id = ?", (item_id,)).fetchone()
    return {**dict(row), "checked": bool(row["checked"]), "tested": bool(row["tested"])}


# Static frontend, mounted last so /api/* wins. html=True serves index.html at /.
app.mount("/", StaticFiles(directory=ROOT, html=True), name="static")
