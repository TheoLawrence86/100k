# 100k

Preparation hub for the 2026 Thames Path Ultra Challenge.

## Current Status

- Registered for the 2026 Thames Path Ultra Challenge.
- Confirmed target: Full Continuous 100 km.
- Event weekend: Saturday 12 September to Sunday 13 September 2026.
- Research date: Monday 8 June 2026.
- Time remaining from research date: 96 days.
- Official event app code from the confirmation email: `TPC26`.

## Event Snapshot

- Organiser: Ultra Challenge Series / Action Challenge.
- Format: Full Continuous, one push through the day and night if needed.
- Route: Putney / Bishops Park to Henley-on-Thames.
- Distance and elevation: 100 km with about 350 m climb.
- Route character: mostly flat Thames Path terrain, but long enough to stress legs, hips, feet, fuelling, and kit discipline.
- Major route points: Bishops Park, Richmond, Hampton Court, Runnymede, Windsor, Henley-on-Thames.

## The App

This is a **coach-to-client** training app: an expert endurance coach
(persona) guiding one athlete through a 14-week build toward the event.
A FastAPI + SQLite backend serves a vanilla HTML/JS frontend that shows the
coach's daily instruction, the weekly briefing, and a live "miles in the
legs" progress dashboard (completed vs planned km, adherence, longest
session, biggest back-to-back). Logged progress — sessions done, actual km,
daily readiness (green/yellow/red), and notes to the coach — is persisted
server-side in SQLite.

### Run with Docker (recommended)

```bash
docker compose up --build
```

Then open http://localhost:8000. The SQLite file lives on the `coach-db`
named volume, so logged progress survives rebuilds and restarts.

### Run from the published image (GHCR)

Every push to `main` builds the image and publishes it to the GitHub
Container Registry via [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml).
To run it on any box with Docker — no source checkout, no build:

```bash
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

Image: `ghcr.io/theolawrence86/100k:latest` (also tagged `:sha-<short>` per
commit and `:1.2.3` for `v*` git tags). If the package is private, run
`docker login ghcr.io` with a PAT that has `read:packages` first, or make the
package public under the repo's **Packages** settings for unauthenticated pulls.

### Run locally for development

```bash
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

On first start the database (`data/coach.db`) is created and seeded from
`data/training-plan.tsv` plus the coach/client/briefing content in
`backend/seed.py`. Seeding is idempotent and never overwrites logged
progress. To reset, delete `data/coach.db` (or remove the Docker volume) and
restart.

## Project Layout

- [index.html](index.html), [app.js](app.js), [styles.css](styles.css): the frontend (talks to `/api/*`).
- [backend/main.py](backend/main.py): FastAPI app — JSON API plus the static frontend.
- [backend/db.py](backend/db.py): SQLite connection and schema.
- [backend/seed.py](backend/seed.py): idempotent first-run seeding from the TSV and authored coaching content.
- [Dockerfile](Dockerfile), [docker-compose.yml](docker-compose.yml): local build + run.
- [docker-compose.ghcr.yml](docker-compose.ghcr.yml): run the prebuilt image straight from GHCR.
- [.github/workflows/docker-publish.yml](.github/workflows/docker-publish.yml): CI that builds and pushes the image to GHCR.
- [data/training-plan.tsv](data/training-plan.tsv): source-of-truth day-by-day plan (seeds the `sessions` table).
- [docs/research.md](docs/research.md): official facts and source links.
- [docs/full-continuous-plan.md](docs/full-continuous-plan.md): event-day operating plan for the 100 km continuous format.
- [docs/logistics-checklist.md](docs/logistics-checklist.md): app, registration, travel, baggage, and deadline checklist.
- [docs/training-plan.md](docs/training-plan.md): coach-style 14-week distance progression and taper.
- [docs/strength-mobility.md](docs/strength-mobility.md): concise strength, core, and stretching menu.
- [docs/adaptation-rules.md](docs/adaptation-rules.md): simple rules for tiredness, niggles, and missed sessions.

## API

- `GET /api/coach` — coach persona.
- `GET /api/client` — client profile + days to event.
- `GET /api/plan` — every session joined with its log.
- `GET /api/week/{week}` — week briefing + sessions + planned/completed km.
- `POST /api/log/{date}` — upsert done / actual km / readiness / notes for a day.
- `GET /api/progress` — the "miles in the legs" dashboard totals.
- `GET /api/version` — the commit the running image was built from (`dev` locally); shown in the sidebar footer so a stale deploy is obvious.

## Immediate Next Actions

1. Download the Ultra Challenge app and load event code `TPC26`.
2. Confirm the registration shows Full Continuous 100 km.
3. Pull the official event guide, route maps, training guide, kit list, menus, and briefings from the app.
4. Confirm funding type, start-time preference, baggage, and post-finish travel.
5. Run the app daily; log each session so the coach view and progress dashboard stay current.
