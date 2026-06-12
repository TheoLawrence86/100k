"""Idempotent first-run seeding.

The day-by-day plan stays sourced from ``data/training-plan.tsv`` (the same
file the old static viewer parsed). Coach persona, client profile, and the
weekly briefings are authored here from the existing ``docs/*.md`` content.

Each table is seeded only when empty, so re-running never clobbers the
client's logged progress in ``session_log``.
"""

import csv
import sqlite3

from .db import ROOT, connect

TSV_PATH = ROOT / "data" / "training-plan.tsv"

COACH = {
    "name": "Coach Mara Whitfield",
    "title": "Ultra-endurance & multi-day event specialist",
    "bio": (
        "Twenty years coaching athletes through 100 km and multi-day continuous "
        "events: Thames Path, canal-path ultras, and overnight challenges. My job "
        "is to get the miles into your legs safely and on schedule, so race day is "
        "just a longer version of training you have already done."
    ),
    "philosophy": (
        "Easy means easy enough to talk. Long sessions are for feet, food, kit, and "
        "patience, not pace. We build time-on-feet progressively, rehearse fuelling "
        "(30-60 g carbs/hour) and night kit, and taper volume without going soft. "
        "We never chase missed kilometres into the next week. Consistency beats heroics."
    ),
}

CLIENT = {
    "name": "Grant",
    "event": "Thames Path Ultra Challenge, Full Continuous 100 km",
    "event_date": "2026-09-12",
    "start_date": "2026-06-13",
    "target": "Finish comfortably; avoid foot, fuelling, pacing, and logistics failures.",
}

# week -> (target_km, focus, coach briefing). Targets/focus from
# docs/training-plan.md "Weekly Distance Targets"; briefings written in the
# coach's voice from the phase notes and coaching rules.
WEEK_BRIEFINGS = {
    1: (14, "Baseline weekend, shoes, easy rhythm",
        "Welcome weekend. Two days to establish a baseline and finish both sessions "
        "fresh. Keep everything conversational and start dialling in shoes and socks. "
        "The full weekly rhythm starts Monday."),
    2: (38, "First fuelling practice",
        "We add a little volume and start eating on the long session. Practise "
        "30 g carbs/hour. This is where fuelling stops being an afterthought."),
    3: (45, "Build the long run toward 20 km",
        "Long session grows toward 20 km. Relaxed rhythm, feet first. Note which "
        "foods still appeal after 2-4 hours."),
    4: (52, "Checkpoint routine starts",
        "Biggest base week. We rehearse the stop routine: refill, eat, check feet, "
        "layer, leave. Short and deliberate."),
    5: (35, "Cutback and recovery",
        "Planned cutback. Less volume, same frequency. Let the work from weeks 1-4 "
        "settle into your legs."),
    6: (60, "26 km long run",
        "Specific endurance build begins. Long session out to ~26 km. Keep eating "
        "every 30-45 minutes and drinking before thirst."),
    7: (68, "30 km long run + tired legs",
        "Back-to-back weekend so you learn to start tired. That is event day in "
        "miniature. Long session ~30 km, easy run the day after."),
    8: (50, "Cutback + night kit",
        "Recover, then start testing night kit: head torch, backup light, layers, "
        "charging. Finish at least one session in the dark."),
    9: (76, "Full-kit long run",
        "Peak specificity. Long session in full event kit: vest, bottles, lights. "
        "Make it as event-like as possible."),
    10: (84, "38 km long run + reset rehearsal",
         "Big long run to ~38 km and a rehearsal of the Runnymede 50 km reset: food, "
         "socks, shoes, layers, battery, blister care."),
    11: (90, "Peak: 40 km + 22 km back-to-back",
         "Peak weekend: 40 km then 22 km, NOT a solo 70 km damage session. One "
         "sequence should start tired and finish after dark. Confirm logistics by Sat 22 Aug."),
    12: (60, "Taper 1, final big check",
         "Taper begins. Volume comes down, frequency stays. One last confidence "
         "check, then no more kit experiments."),
    13: (38, "Taper 2, stay fresh",
         "Stay fresh. Prioritise sleep, foot health, and nutrition consistency. "
         "Pack early and check against the official kit list."),
    14: (113, "Race week, includes the 100 km event",
         "Race week. Short, easy, sharp. Charge devices, pack early. On Saturday: "
         "start easier than feels necessary, treat the night as a planned phase, and "
         "reset, don't finish, at Runnymede 50 km."),
}


# Race-kit checklist, distilled from docs/logistics-checklist.md ("Kit and
# Nutrition" plus the admin items that gate race day). ``tested`` tracks the
# coach's rule that nothing goes to the start line untested in training.
KIT_ITEMS = [
    ("Feet", "Primary race shoes (worn on 30 km+ runs)"),
    ("Feet", "Race socks + spare pairs"),
    ("Feet", "Spare shoes/socks in Runnymede halfway bag"),
    ("Feet", "Blister kit: tape, plasters, lube"),
    ("Night", "Head torch (fits, charged, comfortable)"),
    ("Night", "Backup light + spare batteries"),
    ("Night", "Power bank + charging cables"),
    ("Night", "Reflective layer for the night section"),
    ("Clothing", "Waterproof jacket (tested in rain)"),
    ("Clothing", "Warm layers for the overnight drop in temperature"),
    ("Clothing", "Hat and gloves"),
    ("Clothing", "Race vest/pack at event-day weight"),
    ("Fuel", "Race nutrition: 30-60 g carbs/hour, tested on long runs"),
    ("Fuel", "Bottles/bladder for the vest"),
    ("Fuel", "Backup calories in case food stops disappoint"),
    ("Admin", "Ultra Challenge app installed, event code TPC26 loaded"),
    ("Admin", "Start time confirmed and travel to Putney planned"),
    ("Admin", "Henley finish plan: pickup or self-supported"),
]


def _parse_tsv() -> list[dict]:
    with TSV_PATH.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh, delimiter="\t"))


def _is_empty(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0


def seed() -> None:
    with connect() as conn:
        if _is_empty(conn, "coach"):
            conn.execute(
                "INSERT INTO coach (id, name, title, bio, philosophy) VALUES (1, ?, ?, ?, ?)",
                (COACH["name"], COACH["title"], COACH["bio"], COACH["philosophy"]),
            )

        if _is_empty(conn, "client"):
            conn.execute(
                "INSERT INTO client (id, name, event, event_date, start_date, target) "
                "VALUES (1, ?, ?, ?, ?, ?)",
                (CLIENT["name"], CLIENT["event"], CLIENT["event_date"],
                 CLIENT["start_date"], CLIENT["target"]),
            )

        if _is_empty(conn, "week_briefings"):
            conn.executemany(
                "INSERT INTO week_briefings (week, target_km, focus, briefing) "
                "VALUES (?, ?, ?, ?)",
                [(w, t, f, b) for w, (t, f, b) in WEEK_BRIEFINGS.items()],
            )

        if _is_empty(conn, "sessions"):
            rows = _parse_tsv()
            conn.executemany(
                "INSERT INTO sessions (date, day, week, phase, distance_km, type, "
                "session, duration, equipment, fuel, coach_note) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        r["date"], r["day"], int(r["week"]), r["phase"],
                        float(r["distance_km"] or 0), r["type"], r["session"],
                        r["duration"], r["equipment"], r["fuel"], r["coach"],
                    )
                    for r in rows
                ],
            )

        if _is_empty(conn, "kit_items"):
            conn.executemany(
                "INSERT INTO kit_items (category, label, sort) VALUES (?, ?, ?)",
                [(cat, label, i) for i, (cat, label) in enumerate(KIT_ITEMS)],
            )
