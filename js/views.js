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

const VIEW_TITLES = {
  dashboard: ["Race ops", "Dashboard"],
  calendar: ["Athlete plan", "Calendar"],
  plan: ["Athlete plan", "Training log"],
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
  $("#todayDistance").textContent = rowDistance(row) ? `${rowDistance(row)} km` : "—";
  $("#todayDuration").textContent = row.duration || "—";
  $("#todayEquipment").textContent = row.equipment || "—";
  $("#todayFuel").textContent = row.fuel || "—";

  $("#doneToggle").checked = Boolean(row.done);
  $("#actualKm").value = row.completed_km ?? "";
  $("#readinessSelect").value = row.readiness || "green";
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
      `(~${client.night.dark_hours} h dark — train the head torch)`;
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
    el.textContent = "—";
    status.textContent = "Building a baseline";
    status.className = "load-status";
  } else {
    el.textContent = `${ratio.toFixed(2)}×`;
    const [cls, label] =
      ratio > 1.5 ? ["red", "Ramping hard — be careful"]
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
      : `Your training has carried you ${wp.km} km up the Thames — level with ${wp.name}`;
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
      <td><input type="checkbox" ${row.done ? "checked" : ""} aria-label="Done ${row.date}"></td>
      <td><strong>${formatDate(row.date)}</strong><br><span class="muted-block">W${row.week}</span></td>
      <td><strong>${row.distance_km || 0}</strong></td>
      <td>${row.type}</td>
      <td>${row.session}<br><span class="muted-block">${row.coach_note || ""}</span></td>
      <td>${row.duration}</td>
      <td>${row.equipment}</td>
      <td>${row.fuel}</td>
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
  const packed = items.filter((i) => i.checked).length;
  $("#kitSummary").textContent = `${packed} of ${items.length} packed · ${items.filter((i) => i.tested).length} tested in training`;

  list.innerHTML = "";
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
      <button type="button" class="tested-pill${item.tested ? " on" : ""}"
        aria-pressed="${item.tested}">${item.tested ? "✓ tested" : "untested"}</button>
    `;
    row.querySelector("input").addEventListener("change", (e) => ctx.updateKit(item, { checked: e.target.checked }));
    row.querySelector(".tested-pill").addEventListener("click", () => ctx.updateKit(item, { tested: !item.tested }));
    list.appendChild(row);
  });
}
