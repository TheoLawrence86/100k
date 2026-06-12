"""FastAPI app: coach→client training API plus the static frontend.

Routes under ``/api`` return JSON; everything else is served from the repo
root as static files so ``index.html`` / ``app.js`` / ``styles.css`` load
from the same origin (no CORS, no second server).
"""

import base64
import json
import math
import os
import random
import time
import urllib.error
import urllib.request
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta

from fastapi import Depends, FastAPI, HTTPException, Request
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

# Authorisation on top of App Service Easy Auth. Easy Auth only checks that
# the visitor *has* an account with a configured provider; with Google
# enabled that's anyone on Earth, so the app must check *who* signed in.
# Comma-separated emails; unset means open (local dev, no Easy Auth proxy).
ALLOWED_EMAILS = {
    e.strip().lower()
    for e in os.environ.get("ALLOWED_EMAILS", "").split(",")
    if e.strip()
}


def _principal_email(request: Request) -> str | None:
    """Email from the X-MS-CLIENT-PRINCIPAL header Easy Auth injects."""
    header = request.headers.get("x-ms-client-principal")
    if not header:
        return None
    try:
        principal = json.loads(base64.b64decode(header))
    except (ValueError, json.JSONDecodeError):
        return None
    for claim in principal.get("claims", []):
        if claim.get("typ") in (
            "preferred_username",
            "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
            "email",
        ):
            return claim.get("val", "").lower()
    return None


@app.middleware("http")
async def email_allowlist(request: Request, call_next):
    if ALLOWED_EMAILS:
        email = _principal_email(request)
        if email not in ALLOWED_EMAILS:
            return JSONResponse(
                {"detail": f"Signed in as {email or 'unknown'}, "
                           "but this account is not authorised."},
                status_code=403,
            )
    return await call_next(request)


def current_user_id(request: Request) -> int:
    """The signed-in visitor's users.id, created on first sight.

    Identity comes from the Easy Auth principal header; without it (local
    dev, no proxy) everything maps to a fixed dev user. Each user's logs and
    kit state are scoped to this id, so visitors never see each other's data.
    """
    email = _principal_email(request) or "dev@local"
    with connect() as conn:
        conn.execute("INSERT OR IGNORE INTO users (email) VALUES (?)", (email,))
        return conn.execute(
            "SELECT id FROM users WHERE email = ?", (email,)
        ).fetchone()["id"]


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


def _plan_rows(conn, user_id: int) -> list[dict]:
    rows = conn.execute(
        """
        SELECT s.*, l.done, l.completed_km, l.readiness, l.notes
        FROM sessions s
        LEFT JOIN session_log l ON l.date = s.date AND l.user_id = ?
        ORDER BY s.date
        """,
        (user_id,),
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
def get_plan(user_id: int = Depends(current_user_id)):
    with connect() as conn:
        return _plan_rows(conn, user_id)


@app.get("/api/week/{week}")
def get_week(week: int, user_id: int = Depends(current_user_id)):
    with connect() as conn:
        briefing = conn.execute(
            "SELECT * FROM week_briefings WHERE week = ?", (week,)
        ).fetchone()
        sessions = [r for r in _plan_rows(conn, user_id) if r["week"] == week]
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
def upsert_log(log_date: str, body: LogIn, user_id: int = Depends(current_user_id)):
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
            INSERT INTO session_log (user_id, date, done, completed_km, readiness, notes, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(user_id, date) DO UPDATE SET
                done = excluded.done,
                completed_km = excluded.completed_km,
                readiness = excluded.readiness,
                notes = excluded.notes,
                updated_at = excluded.updated_at
            """,
            (user_id, log_date, int(body.done), body.completed_km, body.readiness, body.notes),
        )
        row = conn.execute(
            "SELECT date, done, completed_km, readiness, notes, updated_at "
            "FROM session_log WHERE user_id = ? AND date = ?",
            (user_id, log_date),
        ).fetchone()
    return dict(row)


def _completed_value(s: dict) -> float:
    if not s["done"]:
        return 0.0
    if s["completed_km"] is not None:
        return s["completed_km"]
    return s["distance_km"] or 0.0


@app.get("/api/progress")
def get_progress(user_id: int = Depends(current_user_id)):
    today = date.today().isoformat()
    with connect() as conn:
        plan = _plan_rows(conn, user_id)

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
def get_load(user_id: int = Depends(current_user_id)):
    """Training-load model + chart series: daily acute/chronic ratio, weekly
    planned-vs-completed, and the cumulative plan-vs-actual lines."""
    today = date.today()
    with connect() as conn:
        plan = _plan_rows(conn, user_id)
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
def get_brief(for_date: str | None = None, user_id: int = Depends(current_user_id)):
    """The coach's generated daily brief: readiness + load ratio + yesterday's
    log + the week focus, folded into one instruction (docs/adaptation-rules.md)."""
    try:
        day = date.fromisoformat(for_date) if for_date else date.today()
    except ValueError:
        raise HTTPException(400, "for_date must be YYYY-MM-DD")

    with connect() as conn:
        plan = _plan_rows(conn, user_id)
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


# ---------- loop route generator ----------
#
# Builds a runnable loop from the athlete's location: waypoints are placed on
# a circle through the start point, snapped to real footpaths by the public
# OSRM foot profile (FOSSGIS / routing.openstreetmap.de), and the circle
# radius is re-scaled until the routed distance lands on the target.

OSRM_FOOT = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/"
EARTH_RADIUS_M = 6_371_000


def _offset(lat: float, lon: float, dist_m: float, bearing_rad: float):
    dlat = dist_m * math.cos(bearing_rad) / EARTH_RADIUS_M
    dlon = dist_m * math.sin(bearing_rad) / (
        EARTH_RADIUS_M * math.cos(math.radians(lat))
    )
    return lat + math.degrees(dlat), lon + math.degrees(dlon)


def _osrm_loop(points: list[tuple[float, float]]) -> tuple[float, list]:
    coords = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in points)
    url = f"{OSRM_FOOT}{coords}?overview=full&geometries=geojson&continue_straight=true"
    req = urllib.request.Request(url, headers={"User-Agent": "coach-to-client-100k"})
    data = None
    for attempt in (1, 2):  # the public server drops connections now and then
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.load(resp)
            break
        except urllib.error.HTTPError as exc:
            raise HTTPException(502, f"routing service refused (HTTP {exc.code})") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == 2:
                raise HTTPException(502, f"routing service unreachable: {exc}") from exc
            time.sleep(0.5)
    if data.get("code") != "Ok" or not data.get("routes"):
        raise HTTPException(502, "routing service could not build a route here")
    route = data["routes"][0]
    # GeoJSON is [lon, lat]; flip to [lat, lon] for the frontend.
    return route["distance"], [[c[1], c[0]] for c in route["geometry"]["coordinates"]]


def _loop_waypoints(lat: float, lon: float, radius_m: float, bearing: float):
    """A ring of waypoints through (lat, lon): the circle's centre sits at
    `radius_m` along `bearing`, so the start is always on the circle."""
    centre = _offset(lat, lon, radius_m, bearing)
    back = bearing + math.pi  # angle from centre back to the start
    n = 6
    points = [(lat, lon)]
    for i in range(1, n):
        points.append(_offset(*centre, radius_m, back + 2 * math.pi * i / n))
    points.append((lat, lon))
    return points


@app.get("/api/route")
def get_route(lat: float, lon: float, km: float, seed: int = 0):
    """Generate a loop run of roughly `km` starting and ending at (lat, lon).
    Different `seed` values send the loop off in a different direction."""
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(400, "bad coordinates")
    km = max(1.0, min(km, 60.0))
    target_m = km * 1000

    bearing = random.Random(seed).uniform(0, 2 * math.pi)
    # Footpaths wiggle, so the routed loop runs longer than the circle's
    # circumference; start a touch small and calibrate.
    radius = target_m / (2 * math.pi) * 0.85
    best = None
    for _ in range(4):
        distance, coords = _osrm_loop(_loop_waypoints(lat, lon, radius, bearing))
        if best is None or abs(distance - target_m) < abs(best[0] - target_m):
            best = (distance, coords)
        error = distance / target_m
        if 0.93 <= error <= 1.07:
            break
        radius *= max(0.5, min(2.0, 1 / error))

    distance, coords = best
    return {
        "target_km": round(km, 1),
        "actual_km": round(distance / 1000, 1),
        "coords": coords,
        "start": [lat, lon],
        "seed": seed,
    }


class KitIn(BaseModel):
    checked: bool | None = None
    tested: bool | None = None


def _kit_row(conn, user_id: int, item_id: int | None = None):
    sql = """
        SELECT k.id, k.label, k.category, k.sort,
               COALESCE(s.checked, 0) AS checked,
               COALESCE(s.tested, 0) AS tested
        FROM kit_items k
        LEFT JOIN kit_state s ON s.item_id = k.id AND s.user_id = ?
    """
    if item_id is not None:
        return conn.execute(sql + " WHERE k.id = ?", (user_id, item_id)).fetchone()
    return conn.execute(sql + " ORDER BY k.sort, k.id", (user_id,)).fetchall()


@app.get("/api/kit")
def get_kit(user_id: int = Depends(current_user_id)):
    with connect() as conn:
        rows = _kit_row(conn, user_id)
    return [
        {**dict(r), "checked": bool(r["checked"]), "tested": bool(r["tested"])}
        for r in rows
    ]


@app.post("/api/kit/{item_id}")
def update_kit(item_id: int, body: KitIn, user_id: int = Depends(current_user_id)):
    with connect() as conn:
        row = _kit_row(conn, user_id, item_id)
        if not row:
            raise HTTPException(404, "no such kit item")
        checked = int(body.checked) if body.checked is not None else row["checked"]
        tested = int(body.tested) if body.tested is not None else row["tested"]
        conn.execute(
            """
            INSERT INTO kit_state (user_id, item_id, checked, tested)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, item_id) DO UPDATE SET
                checked = excluded.checked,
                tested = excluded.tested
            """,
            (user_id, item_id, checked, tested),
        )
        row = _kit_row(conn, user_id, item_id)
    return {**dict(row), "checked": bool(row["checked"]), "tested": bool(row["tested"])}


# Static frontend, mounted last so /api/* wins. html=True serves index.html at /.
app.mount("/", StaticFiles(directory=ROOT, html=True), name="static")
