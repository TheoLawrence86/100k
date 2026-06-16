"""Serve-time coaching extras: pace tethers and strength/stretch routines.

The day-by-day plan in ``data/training-plan.tsv`` carries distance, duration,
kit and fuel but no pace, and the strength/mobility work is only named
("Strength A + mobility") with the actual movements living in
``docs/strength-mobility.md``. The athlete struggles to hold back on the easy
days and wants the routines spelled out, so we compute both here and attach
them to every session as it is served — no schema change, no re-seed, so this
lights up immediately against the already-seeded production database.

Pace is derived from the planned distance and duration range: the *fast* end
of the duration band gives the fastest pace we ever want, which is exactly the
tether ("do not drop below this") for someone who runs the easy days too hard.
"""

import re

# Strength and mobility routines, mirrored from docs/strength-mobility.md so the
# app shows the same movements the plan refers to by label.
STRENGTH_PLANS = {
    "A": [
        "Squat or sit-to-stand — 3 × 8-10",
        "Step-ups — 3 × 8 each leg",
        "Calf raises — 3 × 12-15",
        "Side plank — 3 × 20-40s each side",
        "Dead bug — 3 × 8 each side",
    ],
    "B": [
        "Reverse lunge — 3 × 8 each leg",
        "Hip hinge / Romanian deadlift — 3 × 8-10",
        "Glute bridge — 3 × 12",
        "Band lateral walk — 3 × 10 each way",
        "Front plank — 3 × 30-60s",
    ],
    # Race-week / taper activation: switch the muscles on, add no fatigue.
    "Activation": [
        "Glute bridge — 2 × 10",
        "Band lateral walk — 2 × 10 each way",
        "Bodyweight squat — 2 × 8",
        "Calf raises — 2 × 12",
    ],
}

# "Mobility 10" — the stretch routine that closes every strength session.
MOBILITY_PLAN = [
    "Calves — 60s each",
    "Hip flexors — 60s each",
    "Hamstrings — 60s each",
    "Glutes — 60s each",
    "Thoracic rotations — 10 each side",
]


def _strength_key(session: str) -> str | None:
    """Which strength routine (if any) a session refers to."""
    s = session.lower()
    if "strength a" in s:
        return "A"
    if "strength b" in s:
        return "B"
    if "activation" in s:
        return "Activation"
    if "maintenance strength" in s:
        return "A"  # maintenance week: Strength A, kept light by the coach note
    return None


def _duration_minutes(duration: str) -> tuple[float, float] | None:
    """Parse a duration like ``2-2.5h`` / ``70-90m`` / ``5.5-7h`` into a
    (fast, slow) minute range. Combined entries ("45-60m + 10m") describe the
    run plus mobility, so only the first (the run) drives pace. Returns None
    for unparseable values ("As needed")."""
    head = duration.split("+")[0].strip()
    m = re.match(r"([\d.]+)\s*(?:-\s*([\d.]+))?\s*(h|m)", head)
    if not m:
        return None
    lo = float(m.group(1))
    hi = float(m.group(2)) if m.group(2) else lo
    if m.group(3) == "h":
        lo, hi = lo * 60, hi * 60
    return lo, hi


def _mmss(minutes: float) -> str:
    total = round(minutes * 60)
    return f"{total // 60}:{total % 60:02d}"


# Grant's finish goal for the 100 km event. The plan window is an open
# "20-36h"; this turns it into a concrete pacing plan. Stops cost elapsed time,
# so the moving pace must be quicker than the overall (elapsed) pace — and the
# 20-hour finish is bought by keeping stops short, not by running faster.
GOAL_HOURS = 20.0
EVENT_KM = 100.0
STOPS_MIN_BUDGET = 75          # planned total time stationary (checkpoints + 50 km reset)
STOPS_MIN_RANGE = (60, 90)


def event_pace_plan() -> dict:
    """Concrete 20-hour pacing plan for the 100 km event."""
    elapsed_min = GOAL_HOURS * 60
    overall = elapsed_min / EVENT_KM                          # 12:00/km elapsed
    move_mid = (elapsed_min - STOPS_MIN_BUDGET) / EVENT_KM    # ~11:15/km
    move_fast = (elapsed_min - STOPS_MIN_RANGE[1]) / EVENT_KM  # more stops → move quicker
    move_slow = (elapsed_min - STOPS_MIN_RANGE[0]) / EVENT_KM  # fewer stops → can move slower
    return {
        "range": f"{_mmss(move_fast)}–{_mmss(move_slow)} /km moving",
        "floor": _mmss(move_fast),
        "note": (
            f"20-hour finish: move at ~{_mmss(move_mid)}/km and keep stops short — "
            f"the time comes from not stopping long, not from rushing. Do not dip "
            f"under {_mmss(move_fast)}/km in the first 50 km."
        ),
        "plan": [
            f"Goal — {int(GOAL_HOURS)}:00 elapsed for 100 km",
            f"Overall pace incl. stops — {_mmss(overall)}/km",
            f"Moving pace — ~{_mmss(move_mid)}/km (hold {_mmss(move_fast)}–{_mmss(move_slow)})",
            f"Stops budget — ~{STOPS_MIN_BUDGET} min total "
            f"({STOPS_MIN_RANGE[0]}–{STOPS_MIN_RANGE[1]}), incl. the 50 km Runnymede reset",
            "Halfway (50 km) — aim ~10:00 elapsed, even split",
        ],
    }


def pace_band(distance_km: float, duration: str) -> dict | None:
    """Target pace for a distance session, expressed as a min/km band plus the
    fastest pace the athlete should ever touch (the tether)."""
    if not distance_km or distance_km <= 0:
        return None
    span = _duration_minutes(duration)
    if not span:
        return None
    lo_min, hi_min = span
    fast = lo_min / distance_km  # fastest planned pace = duration's quick end
    slow = hi_min / distance_km
    return {
        "range": f"{_mmss(fast)}–{_mmss(slow)} /km",
        "floor": _mmss(fast),
        "note": f"Hold back: no quicker than {_mmss(fast)}/km — let the easy days stay easy.",
    }


def session_extras(row: dict) -> dict:
    """Pace tether + strength/stretch routines for one plan row.

    A strength session always gets the stretch routine too (the coach pairs
    them); any other session that mentions mobility gets the stretches on their
    own."""
    distance = row.get("distance_km") or 0
    duration = row.get("duration") or ""
    session = row.get("session") or ""

    # The event gets a goal-time pacing plan; everything else an easy band.
    if (row.get("type") or "").lower() == "event" or distance >= EVENT_KM:
        extras: dict = {"pace": event_pace_plan()}
    else:
        extras = {"pace": pace_band(distance, duration)}

    key = _strength_key(session)
    extras["strength"] = STRENGTH_PLANS.get(key) if key else None

    if key or "mobility" in session.lower():
        extras["mobility"] = MOBILITY_PLAN
    else:
        extras["mobility"] = None

    return extras
