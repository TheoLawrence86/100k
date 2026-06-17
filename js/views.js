import {
  state,
  formatDate,
  formatShortDate,
  isoFromDate,
  weekBounds,
  weekRows,
  selectedRow,
  rowDistance,
  typeKey,
} from "./state.js";
import {
  TYPE_COLOURS,
  weekMiniBars,
  sparkline,
  weeklyBars,
  cumulativeChart,
  loadChart,
  renderRouteMap,
  nearestWaypoint,
} from "./charts.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---------- chart tooltips ---------- */
// A single floating tip element follows the pointer over any [data-tip] node.
// data-tip format: "Title|detail line".
let tipEl;
function chartTip() {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "chart-tip";
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

export function wireChartTips() {
  const tip = chartTip();
  $$(".chart [data-tip]").forEach((node) => {
    node.addEventListener("pointerenter", () => {
      const [title, detail] = node.dataset.tip.split("|");
      tip.innerHTML = `<b>${title}</b>${detail ? `<br><span class="tip-k">${detail}</span>` : ""}`;
      tip.classList.add("show");
    });
    node.addEventListener("pointermove", (e) => {
      tip.style.left = `${e.clientX + 14}px`;
      tip.style.top = `${e.clientY - 10}px`;
    });
    node.addEventListener("pointerleave", () => tip.classList.remove("show"));
  });
}

/* ---------- nav icons ---------- */
// Minimal line glyphs, drawn once into every [data-nav] link (rail + tabbar).
const NAV_ICONS = {
  dashboard: '<path d="M3 12l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  plan: '<path d="M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  route: '<path d="M6 19a3 3 0 0 0 3-3V8a3 3 0 0 1 6 0v8"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/>',
  progress: '<path d="M4 19V5M4 19h16"/><path d="M8 16l4-5 3 3 4-6"/>',
  kit: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
};

export function decorateNav() {
  $$("[data-nav]").forEach((link) => {
    if (link.querySelector(".nav-ico")) return;
    const glyph = NAV_ICONS[link.dataset.nav];
    if (!glyph) return;
    const label = link.textContent.trim();
    link.innerHTML =
      `<svg class="nav-ico" viewBox="0 0 24 24" aria-hidden="true">${glyph}</svg><span>${label}</span>`;
  });
}

/* ---------- readiness segmented control ---------- */
export function setReadiness(value) {
  $$("#readinessControl .readiness-opt").forEach((btn) => {
    btn.setAttribute("aria-checked", String(btn.dataset.readiness === value));
  });
}

export function getReadiness() {
  const on = $("#readinessControl .readiness-opt[aria-checked='true']");
  return on ? on.dataset.readiness : "green";
}

// Short pace label for tight spaces (table/calendar): just the band, no prose.
const paceLabel = (row) => (row.pace ? row.pace.range : "");

// The event's goal-time pacing plan as a small bulleted block ("" when absent).
function pacePlanHTML(row) {
  if (!row.pace?.plan?.length) return "";
  return (
    `<div class="routine"><p class="routine-head">20-hour pacing plan</p><ul>` +
    row.pace.plan.map((p) => `<li>${p}</li>`).join("") +
    `</ul></div>`
  );
}

// Strength + stretch routines as a small bulleted block. Returns "" when the
// session has neither, so callers can skip rendering entirely.
function routinesHTML(row) {
  const blocks = [];
  if (row.strength?.length) {
    blocks.push(
      `<div class="routine"><p class="routine-head">Strength</p><ul>` +
        row.strength.map((m) => `<li>${m}</li>`).join("") +
        `</ul></div>`,
    );
  }
  if (row.mobility?.length) {
    blocks.push(
      `<div class="routine"><p class="routine-head">Stretch &amp; mobility</p><ul>` +
        row.mobility.map((m) => `<li>${m}</li>`).join("") +
        `</ul></div>`,
    );
  }
  return blocks.join("");
}

const VIEW_TITLES = {
  dashboard: ["The towpath journal", "Today"],
  calendar: ["Athlete plan", "Calendar"],
  plan: ["Athlete plan", "Training log"],
  route: ["Run from your door", "Route"],
  progress: ["Miles in the legs", "Progress"],
  kit: ["Race day", "Kit checklist"],
};

export function renderChrome() {
  $$("[data-nav]").forEach((link) => {
    link.classList.toggle("active", link.dataset.nav === state.view);
  });
  const [kicker, title] = VIEW_TITLES[state.view] || VIEW_TITLES.dashboard;
  $("#viewKicker").textContent = kicker;
  $("#viewTitle").textContent = title;

  const row = selectedRow();
  if (row) {
    const { monday, sunday } = weekBounds();
    $("#viewSub").textContent =
      `Week ${row.week} · ${formatShortDate(isoFromDate(monday))} – ${formatShortDate(isoFromDate(sunday))} · ${row.phase}`;
  }

  $$("[id^=view-]").forEach((panel) => {
    panel.hidden = panel.id !== `view-${state.view}`;
  });
}

/* ---------- dashboard ---------- */

export function renderDashboard() {
  const row = selectedRow();
  if (!row) return;
  const key = typeKey(row);

  const chip = $("#todayChip");
  chip.textContent = row.type || "Session";
  chip.style.setProperty("--type-bg", `color-mix(in srgb, ${TYPE_COLOURS[key]} 22%, transparent)`);
  chip.style.setProperty("--type-ink", TYPE_COLOURS[key]);

  $("#todayTitle").textContent = row.session;
  $("#todayMeta").textContent = `${formatDate(row.date)} · Week ${row.week} · ${row.phase}`;
  $("#todayDistance").textContent = rowDistance(row) ? `${rowDistance(row)} km` : "-";
  $("#todayPace").textContent = row.pace ? row.pace.range : "-";
  $("#todayDuration").textContent = row.duration || "-";
  $("#todayEquipment").textContent = row.equipment || "-";
  $("#todayFuel").textContent = row.fuel || "-";

  const paceNote = $("#todayPaceNote");
  paceNote.textContent = row.pace ? row.pace.note : "";
  paceNote.hidden = !row.pace;

  const pacePlan = $("#todayPacePlan");
  pacePlan.innerHTML = row.pace?.plan?.length
    ? row.pace.plan.map((p) => `<li>${p}</li>`).join("")
    : "";
  pacePlan.hidden = !pacePlan.innerHTML;

  const routines = $("#todayRoutines");
  routines.innerHTML = routinesHTML(row);
  routines.hidden = !routines.innerHTML;

  $("#doneToggle").checked = Boolean(row.done);
  $("#actualKm").value = row.completed_km ?? "";
  setReadiness(row.readiness || "green");
  $("#noteBox").value = row.notes || "";

  renderBrief();
  renderCountdownTile();
  renderWeekTile();
  renderLoadTile();
  renderMetricTiles();
  renderRouteTile();
}

export function renderBrief() {
  const box = $("#briefBox");
  const brief = state.brief;
  if (!brief || brief.date !== state.selectedDate) {
    box.className = "brief-box";
    $("#briefText").textContent = "…";
    return;
  }
  box.className = `brief-box ${brief.status === "green" ? "" : brief.status}`.trim();
  $("#briefText").textContent = brief.text;
}

function renderCountdownTile() {
  const client = state.client;
  if (!client) return;
  $("#daysToEvent").textContent = client.days_to_event;
  if (client.night) {
    $("#nightLine").innerHTML =
      `Sat 12 – Sun 13 Sep 2026 · Putney → Henley<br>` +
      `Night section: sunset ${client.night.sunset} → sunrise ${client.night.sunrise} ` +
      `(~${client.night.dark_hours} h dark, so train the head torch)`;
  }
}

function renderWeekTile() {
  const rows = weekRows();
  const planned = rows.reduce((sum, r) => sum + rowDistance(r), 0);
  const done = rows.reduce((sum, r) => sum + (r.done ? (r.completed_km ?? rowDistance(r)) : 0), 0);
  $("#weekKm").textContent = `${Math.round(done * 10) / 10} / ${Math.round(planned * 10) / 10} km`;
  $("#weekMiniChart").innerHTML = weekMiniBars(rows, typeKey);
  const doneCount = rows.filter((r) => r.done).length;
  $("#weekTargetLine").textContent = `${doneCount} of ${rows.length} sessions logged`;
}

function renderLoadTile() {
  const load = state.load;
  if (!load || !load.series.length) return;
  const latest = load.series[load.series.length - 1];
  const ratio = latest.ratio;
  const el = $("#loadRatio");
  const status = $("#loadStatus");
  if (ratio === null) {
    el.textContent = "-";
    status.textContent = "Building a baseline";
    status.className = "load-status";
  } else {
    el.textContent = `${ratio.toFixed(2)}×`;
    const [cls, label] =
      ratio > 1.5 ? ["red", "Ramping hard, be careful"]
      : ratio > 1.3 ? ["yellow", "Pushing on"]
      : ratio < 0.8 ? ["green", "Fresh"]
      : ["green", "In the groove"];
    status.textContent = label;
    status.className = `load-status ${cls}`;
  }
  $("#loadSpark").innerHTML = sparkline(load.series.slice(-28).map((s) => s.acute_km));
  $("#loadLine").textContent =
    `${latest.acute_km} km last 7 days · ${latest.chronic_weekly_km} km/week 4-week norm`;
}

function renderMetricTiles() {
  const p = state.progress;
  if (!p) return;
  $("#pgAdherence").textContent = `${p.adherence_pct}%`;
  $("#pgCompleted").textContent = `${p.total_completed_km} km`;
  $("#pgPlannedLine").textContent = `of ${p.total_planned_km} km planned`;
  $("#pgLongest").textContent = `${p.longest_km} km`;
  $("#pgBackToBack").textContent = `${p.back_to_back_km} km`;
}

function renderRouteTile() {
  const p = state.progress;
  const el = $("#routeMap");
  if (!p || !el) return;
  const fraction = p.total_planned_km ? p.total_completed_km / p.total_planned_km : 0;
  renderRouteMap(el, fraction);
  const wp = nearestWaypoint(fraction);
  $("#routeCaption").textContent =
    fraction <= 0.005
      ? "The build starts at Putney Bridge"
      : `Your training has carried you ${wp.km} km up the Thames, level with ${wp.name}`;
  $("#routeSub").textContent =
    `${p.total_completed_km} of ${p.total_planned_km} training km = ${Math.round(fraction * 100)}% of the way to Henley`;
}

/* ---------- calendar ---------- */

export function renderCalendar(ctx) {
  const grid = $("#calendarGrid");
  if (!grid) return;
  const { monday, sunday } = weekBounds();
  $("#weekRange").textContent =
    `${formatShortDate(isoFromDate(monday))} – ${formatShortDate(isoFromDate(sunday))}`;

  const query = state.query.toLowerCase();
  const rowsByDate = new Map(weekRows().map((row) => [row.date, row]));

  grid.innerHTML = "";
  const maxKm = Math.max(...weekRows().map(rowDistance), 1);

  for (let i = 0; i < 7; i += 1) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    const iso = isoFromDate(date);
    const row = rowsByDate.get(iso);
    const matches = row && (!query || Object.values(row).join(" ").toLowerCase().includes(query));

    const card = document.createElement(row ? "button" : "div");
    card.className = `day-card${iso === state.selectedDate ? " is-selected" : ""}${row?.done ? " done" : ""}`;
    if (row) card.type = "button";
    if (row && !matches) card.style.opacity = "0.3";

    const key = row ? typeKey(row) : null;
    card.innerHTML = `
      <div class="day-heading">
        <span>${new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(date)}</span>
        <strong>${new Intl.DateTimeFormat("en-GB", { day: "2-digit" }).format(date)}</strong>
      </div>
      ${row ? `
        <span class="session-title"><span class="type-dot" style="--type-colour:${TYPE_COLOURS[key]}"></span>${row.session}</span>
        <span class="session-meta">${rowDistance(row) ? `${rowDistance(row)} km · ` : ""}${row.duration || ""}</span>
        ${row.pace ? `<span class="session-meta pace">${row.pace.range}</span>` : ""}
        ${row.done ? `<span class="done-tick">✓ logged${row.completed_km != null ? ` ${row.completed_km} km` : ""}</span>` : ""}
        <span class="load-bar"><i style="--type-colour:${TYPE_COLOURS[key]};width:${Math.max(6, (rowDistance(row) / maxKm) * 100)}%"></i></span>
      ` : `<span class="session-meta">No session</span>`}
    `;

    if (row) card.addEventListener("click", () => ctx.select(row.date));
    grid.appendChild(card);
  }

  renderWeekNav();
  ctx.loadWeekBriefing();
}

function renderWeekNav() {
  const prev = $("#prevWeek");
  const next = $("#nextWeek");
  if (!prev || !next || !state.plan.length) return;
  const weeks = state.plan.map((row) => Number(row.week));
  const current = Number(selectedRow().week);
  prev.disabled = current <= Math.min(...weeks);
  next.disabled = current >= Math.max(...weeks);
}

export function renderWeekBriefing(data) {
  $("#briefWeek").textContent = data.briefing.week;
  $("#briefFocus").textContent = data.briefing.focus;
  $("#briefTextWeek").textContent = data.briefing.briefing;
  $("#briefTargets").textContent =
    `Target ${data.briefing.target_km} km · logged ${data.completed_km} of ${data.planned_km} km this week.`;
}

/* ---------- plan table ---------- */

export function renderTable(ctx) {
  const planBody = $("#planBody");
  if (!planBody) return;
  let rows = state.mode === "all" ? state.plan : weekRows();
  if (state.query) {
    const query = state.query.toLowerCase();
    rows = rows.filter((row) => Object.values(row).join(" ").toLowerCase().includes(query));
  }

  planBody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    if (row.done) tr.classList.add("done");
    if (row.date === state.selectedDate) tr.classList.add("is-today");

    tr.innerHTML = `
      <td data-label="Done"><input type="checkbox" ${row.done ? "checked" : ""} aria-label="Done ${row.date}"></td>
      <td data-label="Date"><strong>${formatDate(row.date)}</strong><br><span class="muted-block">Week ${row.week} · ${row.phase || ""}</span></td>
      <td data-label="Distance"><strong>${row.distance_km || 0}</strong> km${row.done && row.completed_km != null ? `<br><span class="muted-block">did ${row.completed_km}</span>` : ""}</td>
      <td data-label="Pace">${paceLabel(row) || "-"}</td>
      <td data-label="Type">${row.type}</td>
      <td data-label="Session">${row.session}<br><span class="muted-block">${row.coach_note || ""}</span>${pacePlanHTML(row)}${routinesHTML(row)}</td>
      <td data-label="Time">${row.duration || "-"}</td>
      <td data-label="Kit">${row.equipment || "-"}</td>
      <td data-label="Fuel">${row.fuel || "-"}</td>
    `;

    tr.querySelector("input").addEventListener("change", (event) => {
      event.stopPropagation();
      ctx.toggleDone(row, event.target.checked);
    });
    tr.addEventListener("click", (event) => {
      if (event.target.tagName === "INPUT") return;
      ctx.select(row.date);
    });

    planBody.appendChild(tr);
  });
}

/* ---------- progress ---------- */

export function renderProgress() {
  const load = state.load;
  const p = state.progress;
  if (load) {
    $("#weeksChart").innerHTML = weeklyBars(load.weeks);
    $("#cumulativeChart").innerHTML = cumulativeChart(load.cumulative);
    $("#loadChart").innerHTML = loadChart(load.series);
    wireChartTips();
  }
  if (!p) return;

  const doneRows = state.plan.filter((row) => row.done);
  const nextLong = state.plan.find((row) => !row.done && row.type === "Long");
  const selectedWeekRows = weekRows();
  const weekDone = selectedWeekRows.filter((row) => row.done).length;

  $("#progressView").innerHTML = `
    <article class="insight-card"><span>Total completed</span><strong>${p.total_completed_km} km</strong>
      <p>${doneRows.length} sessions logged against ${p.total_planned_km} km planned.</p></article>
    <article class="insight-card"><span>This week</span><strong>${p.week_completed_km} / ${p.week_planned_km} km</strong>
      <p>${weekDone} of ${selectedWeekRows.length} sessions are marked done in the selected week.</p></article>
    <article class="insight-card"><span>Adherence</span><strong>${p.adherence_pct}%</strong>
      <p>${p.adherence_pct > 100 ? "Logged ahead of the plan to date." : "Compared with planned distance to date."}</p></article>
    <article class="insight-card"><span>Longest session</span><strong>${p.longest_km} km</strong>
      <p>Longest completed session logged so far.</p></article>
    <article class="insight-card"><span>Back-to-back</span><strong>${p.back_to_back_km} km</strong>
      <p>Best completed pair on consecutive calendar days.</p></article>
    <article class="insight-card"><span>Next long effort</span><strong>${nextLong ? `${nextLong.distance_km} km` : "Done"}</strong>
      <p>${nextLong ? `${formatDate(nextLong.date)} · ${nextLong.session}` : "No future long sessions remaining."}</p></article>
  `;
}

/* ---------- kit ---------- */

export function renderKit(ctx) {
  const list = $("#kitView");
  if (!list) return;
  const items = state.kit;
  const total = items.length || 1;
  const packed = items.filter((i) => i.checked).length;
  const tested = items.filter((i) => i.tested).length;
  $("#kitSummary").textContent = `${packed} of ${items.length} packed · ${tested} tested in training`;

  list.innerHTML = "";

  // Two progress meters so "how ready is my kit" reads at a glance.
  const meters = document.createElement("div");
  meters.className = "kit-progress";
  meters.innerHTML = `
    <div class="kit-meter">
      <span class="kit-meter-label">Packed</span>
      <div class="meter"><i style="width:${Math.round((packed / total) * 100)}%"></i></div>
      <b>${packed}/${items.length}</b>
    </div>
    <div class="kit-meter">
      <span class="kit-meter-label">Tested</span>
      <div class="meter tested"><i style="width:${Math.round((tested / total) * 100)}%"></i></div>
      <b>${tested}/${items.length}</b>
    </div>`;
  list.appendChild(meters);

  let lastCat = null;
  items.forEach((item) => {
    if (item.category !== lastCat) {
      lastCat = item.category;
      const head = document.createElement("p");
      head.className = "kit-cat";
      head.textContent = item.category;
      list.appendChild(head);
    }
    const row = document.createElement("div");
    row.className = `kit-item${item.checked ? " checked" : ""}`;
    row.innerHTML = `
      <input type="checkbox" id="kit-${item.id}" ${item.checked ? "checked" : ""}>
      <label class="kit-label" for="kit-${item.id}">${item.label}</label>
      <span class="kit-spacer"></span>
      <button type="button" class="tested-toggle${item.tested ? " on" : ""}" aria-pressed="${item.tested}"
        aria-label="${item.tested ? "Tested in training" : "Mark as tested in training"}">
        <span class="tested-mark" aria-hidden="true"></span>
        <span class="tested-text">${item.tested ? "Tested" : "Test it"}</span>
      </button>
    `;
    row.querySelector("input").addEventListener("change", (e) => ctx.updateKit(item, { checked: e.target.checked }));
    row.querySelector(".tested-toggle").addEventListener("click", () => ctx.updateKit(item, { tested: !item.tested }));
    list.appendChild(row);
  });
}
