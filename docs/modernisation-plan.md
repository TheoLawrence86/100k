# Modernisation Plan — Thames Path Ultra Hub

Research date: 9 June 2026 (95 days to event). Based on a review of the
current app and research into Runna, TrainingPeaks, Strava, COROS,
UltraCoach, and 2026 dashboard/UI trends.

## Where the app stands today

Strengths worth keeping:

- Tight coach→athlete concept (daily instruction, weekly briefing, readiness
  traffic light) — most commercial apps don't have this narrative voice.
- Zero-build vanilla stack: fast, no framework churn, easy to maintain.
- Server-persisted log with adherence/back-to-back metrics already in place.

What dates it:

- **Light-only, low-contrast beige theme.** Data-heavy training products in
  2026 are dark-first (WHOOP, COROS, Linear-style dashboards); the purple
  sidebar + cream workbench reads ~2019 SaaS.
- **The calendar is a fake time-grid.** Cards are absolutely positioned with
  arbitrary `top` offsets against a decorative hour rail ("Easy/Build/Long/
  Log/Recover") — it looks like Google Calendar but the vertical axis means
  nothing. Modern training UIs (Runna, TrainingPeaks) use a week strip of
  session cards sized by load, not a pseudo-timetable.
- **Numbers without pictures.** Progress is six stat cards; no sparkline, no
  weekly volume bars, no plan-vs-actual area chart, no training-load (CTL-
  style) curve. Every comparable product leads with charts.
- **No sense of the journey.** Nothing shows the 14-week arc, the taper, or
  "you are here" — the single most motivating visual for a one-goal app.
- **Desktop-first.** Three fixed columns; on the phone (where logging
  actually happens, post-run) it's a long scroll with the logger at the
  bottom.

## Design direction

Dark-first "race ops" aesthetic:

- **Dark theme by default** with a `prefers-color-scheme`-aware toggle.
  Near-black blue-grey surfaces, one electric accent (Thames teal), session
  type colours kept but re-tuned for dark backgrounds.
- **Bento-grid dashboard** as the new home view: hero tile = today's
  session + log controls; feature tiles = countdown, week volume chart,
  training-load sparkline, readiness streak; metric cards = adherence,
  longest, back-to-back. Tile size reflects importance, not data volume.
- **Subtle glassmorphism as accent only** (translucent topbar/today panel
  over a faint route-map backdrop), not the whole language.
- **Typography upgrade:** a display face for big numbers (e.g. variable
  Inter Tight / Space Grotesk) + `font-variant-numeric: tabular-nums` for
  stats; fluid type via `clamp()`.
- **Micro-interactions:** view transitions (View Transitions API),
  animated number count-ups, a satisfying "session done" tick animation,
  `prefers-reduced-motion` respected.

## Novel features (the differentiators)

1. **Race-line journey map.** A horizontal SVG of the actual Thames route
   (Putney → Richmond → Hampton Court → Runnymede → Windsor → Henley) where
   cumulative completed km moves a marker along the river. "Your training
   has carried you to Windsor" beats "412 km logged". Also works as the
   taper visual: weeks 1–14 plotted as a load mountain with race day at
   the end.
2. **Training-load model.** Compute simple acute (7-day) vs chronic
   (28-day) load from logged km in the backend and chart the ratio — the
   COROS/TrainingPeaks "are you ramping too fast?" signal, derived from
   data already in SQLite. Surface it as a freshness gauge that feeds the
   coach's daily note.
3. **Smarter coach voice.** The adaptation box becomes a generated daily
   brief: combines readiness colour, yesterday's log, load ratio, and the
   week briefing into one paragraph ("Yellow two days running and your
   acute load is 1.4× chronic — today's 10k becomes 6k easy."). Rules
   already exist in `docs/adaptation-rules.md`; encode them server-side.
4. **Night-section countdown.** Full Continuous means running through the
   night: show sunset/sunrise for race weekend and flag long runs planned
   to rehearse headtorch hours.
5. **Kit checklist that learns.** Convert the kit view into a checkable
   race-kit list with state persisted per item, plus a "tested in
   training?" flag — kit discipline is called out in the README as a goal.
6. **PWA + mobile log-first layout.** Manifest + service worker so it
   installs on the phone; on small screens the logger is a bottom sheet
   one thumb-tap away, and the week is a swipeable card strip.

## Technical overhaul

Keep the stack (FastAPI + SQLite + vanilla JS) — modernise within it:

- **CSS:** design tokens via custom properties with light/dark schemes
  (`color-scheme`, `light-dark()`), container queries for the panels,
  CSS nesting, `@layer` for structure. Delete the pseudo-time-grid.
- **Charts:** no chart library needed — inline SVG sparklines/bars
  (~100 lines) keep the zero-dependency ethos; or adopt µPlot (~40 kB)
  if interactivity is wanted.
- **JS:** split `app.js` into ES modules (`api.js`, `state.js`,
  `views/*.js`); add a tiny hash router so views are linkable
  (`#/calendar`, `#/progress`).
- **Backend:** add `/api/load` (acute/chronic series), `/api/brief`
  (generated daily coach brief), `/api/kit` (checklist state); move
  `@app.on_event("startup")` to a lifespan handler (deprecated API).
- **Quality:** Lighthouse pass (a11y contrast on the new dark theme),
  keyboard navigation for the week strip, focus states.

## Suggested phasing

1. **Phase 1 — Look & feel:** dark-first token system, typography, bento
   dashboard home, kill the fake time grid, mobile bottom-sheet logger.
2. **Phase 2 — Data viz:** SVG week-volume bars, plan-vs-actual cumulative
   chart, load ratio endpoint + freshness gauge.
3. **Phase 3 — Novelties:** Thames route journey map, generated coach
   brief, night-section awareness, kit checklist persistence.
4. **Phase 4 — Platform:** PWA install, view transitions, ES module
   refactor, Lighthouse/a11y pass.

Sources: Runify Strava-sync roundup, ROUVY & FindYourEdge 2026 app
reviews, Runna vs Strava, Midrocket & Gezar 2026 UI trend guides, Orbix
bento dashboard guide, COROS Training Status, UltraCoach.
