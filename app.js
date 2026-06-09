const state = {
  plan: [],
  mode: "week",
  view: "calendar",
  selectedDate: todayIso(),
  query: "",
  progress: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const datePicker = $("#datePicker");
const prevWeek = $("#prevWeek");
const nextWeek = $("#nextWeek");
const searchInput = $("#searchInput");
const planBody = $("#planBody");
const calendarGrid = $("#calendarGrid");
const progressView = $("#progressView");
const kitView = $("#kitView");
const noteBox = $("#noteBox");
const doneToggle = $("#doneToggle");
const actualKm = $("#actualKm");
const readinessSelect = $("#readinessSelect");
const adapt = $("#adapt");

function todayIso() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

async function api(path, options) {
  const res = await fetch(`/api${path}`, options);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

function formatDate(iso) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(`${iso}T12:00:00`));
}

function formatShortDate(iso) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  }).format(new Date(`${iso}T12:00:00`));
}

function selectedRow() {
  return state.plan.find((row) => row.date === state.selectedDate) || state.plan[0];
}

function rowDistance(row) {
  return Number.parseFloat(row.distance_km || "0") || 0;
}

function weekRows() {
  const { monday, sunday } = weekBounds();
  return state.plan.filter((row) => {
    const date = new Date(`${row.date}T12:00:00`);
    return date >= monday && date <= sunday;
  });
}

function weekBounds() {
  const selected = new Date(`${state.selectedDate}T12:00:00`);
  const day = selected.getDay() || 7;
  const monday = new Date(selected);
  monday.setDate(selected.getDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { monday, sunday };
}

function isoFromDate(date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function planBounds() {
  return { min: state.plan[0].date, max: state.plan[state.plan.length - 1].date };
}

// Step the selected date by whole weeks, clamped to the plan's first/last day.
function shiftWeek(deltaDays) {
  if (!state.plan.length) return;
  const base = new Date(`${state.selectedDate}T12:00:00`);
  base.setDate(base.getDate() + deltaDays);
  let iso = isoFromDate(base);
  const { min, max } = planBounds();
  if (iso < min) iso = min;
  if (iso > max) iso = max;
  state.selectedDate = iso;
  state.mode = "week";
  datePicker.value = iso;
  render();
}

function renderWeekNav() {
  if (!prevWeek || !nextWeek || !state.plan.length) return;
  const weeks = state.plan.map((row) => Number(row.week));
  const current = Number(selectedRow().week);
  prevWeek.disabled = current <= Math.min(...weeks);
  nextWeek.disabled = current >= Math.max(...weeks);
}

function rowsForMode() {
  let rows = state.mode === "all" ? state.plan : state.mode === "today" ? [selectedRow()] : weekRows();
  if (state.query) {
    const query = state.query.toLowerCase();
    rows = rows.filter((row) => Object.values(row).join(" ").toLowerCase().includes(query));
  }
  return rows;
}

function typeClass(row) {
  const type = `${row.type || ""} ${row.session || ""}`.toLowerCase();
  if (type.includes("long")) return "type-long";
  if (type.includes("strength")) return "type-strength";
  if (type.includes("recovery")) return "type-recovery";
  if (type.includes("rest")) return "type-rest";
  if (type.includes("mobility")) return "type-mobility";
  if (type.includes("easy")) return "type-easy";
  return "type-default";
}

function durationMinutes(row) {
  const text = `${row.duration || ""}`.toLowerCase();
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*h/);
  if (hourMatch) return Number.parseFloat(hourMatch[1]) * 60;
  const minuteMatch = text.match(/(\d+)\s*m/);
  if (minuteMatch) return Number.parseFloat(minuteMatch[1]);
  const range = text.match(/(\d+)\s*-\s*(\d+)/);
  if (range) return Number.parseFloat(range[2]);
  return Math.max(45, rowDistance(row) * 13);
}

// --- persistence: every change posts the full log row for the selected day ---

function selectedLogPayload() {
  const value = Number.parseFloat(actualKm.value);
  return {
    done: doneToggle.checked,
    completed_km: Number.isFinite(value) ? value : null,
    readiness: readinessSelect.value,
    notes: noteBox.value,
  };
}

async function saveSelected() {
  const row = selectedRow();
  if (!row) return;
  const saved = await api(`/log/${row.date}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(selectedLogPayload()),
  });
  // mirror saved state back into the in-memory plan so the table stays in sync
  Object.assign(row, {
    done: Boolean(saved.done),
    completed_km: saved.completed_km,
    readiness: saved.readiness,
    notes: saved.notes,
  });
  render();
  refreshProgress();
}

let noteTimer;
function saveSelectedDebounced() {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(saveSelected, 500);
}

// --- rendering ---

function renderToday() {
  const row = selectedRow();
  if (!row) return;
  const distance = rowDistance(row);
  $("#todayTitle").textContent = row.session;
  $("#todayMeta").textContent = `${formatDate(row.date)} · Week ${row.week} · ${row.phase}`;
  $("#todayDistance").textContent = distance ? `${distance} km` : "0 km";
  $("#todayDuration").textContent = row.duration;
  $("#todayEquipment").textContent = row.equipment;
  $("#todayFuel").textContent = row.fuel;
  $("#todayCoach").textContent = row.coach_note || "";

  doneToggle.checked = Boolean(row.done);
  actualKm.value = row.completed_km ?? "";
  readinessSelect.value = row.readiness || "green";
  noteBox.value = row.notes || "";
  renderAdaptation();
}

function renderAdaptation() {
  const value = readinessSelect.value;
  adapt.className = `adapt ${value}`;
  const title = $("#adaptTitle");
  const text = $("#adaptText");
  if (value === "yellow") {
    title.textContent = "Yellow";
    text.textContent = "Cut duration by 30-50%; skip intensity and heavy strength.";
  } else if (value === "red") {
    title.textContent = "Red";
    text.textContent = "Rest, mobility only, and do not cram missed work tomorrow.";
  } else {
    title.textContent = "Green";
    text.textContent = "Do the plan as written.";
  }
}

function renderCalendar() {
  if (!calendarGrid) return;
  const { monday, sunday } = weekBounds();
  const selected = selectedRow();
  $("#weekRange").textContent = `${formatShortDate(isoFromDate(monday))} - ${formatShortDate(isoFromDate(sunday))}`;

  const query = state.query.toLowerCase();
  const rowsByDate = new Map(
    weekRows()
      .filter((row) => !query || Object.values(row).join(" ").toLowerCase().includes(query))
      .map((row) => [row.date, row])
  );

  calendarGrid.innerHTML = "";
  const rail = document.createElement("div");
  rail.className = "time-rail";
  ["Easy", "Build", "Long", "Log", "Recover"].forEach((label) => {
    const slot = document.createElement("span");
    slot.textContent = label;
    rail.appendChild(slot);
  });
  calendarGrid.appendChild(rail);

  for (let i = 0; i < 7; i += 1) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    const iso = isoFromDate(date);
    const row = rowsByDate.get(iso);
    const column = document.createElement("div");
    column.className = `day-column${iso === state.selectedDate ? " is-selected" : ""}`;

    const heading = document.createElement("div");
    heading.className = "day-heading";
    heading.innerHTML = `${new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(date)}<strong>${new Intl.DateTimeFormat("en-GB", { day: "2-digit" }).format(date)}</strong>`;
    column.appendChild(heading);

    if (row) {
      const card = document.createElement("button");
      const height = Math.max(70, Math.min(290, durationMinutes(row) * 1.25));
      const top = row.type === "Rest" ? 118 : row.type === "Long" ? 98 : 84 + i * 8;
      card.type = "button";
      card.className = `session-card ${typeClass(row)}${row.done ? " done" : ""}${row.date === selected.date ? " is-selected" : ""}`;
      card.style.top = `${top}px`;
      card.style.height = `${height}px`;
      card.innerHTML = `
        <strong>${row.session}</strong>
        <span>${row.distance_km || 0} km · ${row.duration}</span>
        <em>${row.type}</em>
      `;
      card.addEventListener("click", () => {
        state.selectedDate = row.date;
        datePicker.value = row.date;
        render();
      });
      column.appendChild(card);
    }

    calendarGrid.appendChild(column);
  }
}

function renderViewPanels() {
  $$("[data-view]").forEach((button) => {
    const isActive = button.dataset.view === state.view;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  $$("[data-view-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== state.view;
  });
}

function renderProgressView() {
  if (!progressView || !state.progress) return;
  const p = state.progress;
  const doneRows = state.plan.filter((row) => row.done);
  const remainingRows = state.plan.filter((row) => !row.done);
  const nextLong = remainingRows.find((row) => row.type === "Long");
  const selectedWeekRows = weekRows();
  const weekDone = selectedWeekRows.filter((row) => row.done).length;

  progressView.innerHTML = `
    <article class="insight-card">
      <span>Total completed</span>
      <strong>${p.total_completed_km} km</strong>
      <p>${doneRows.length} sessions logged against ${p.total_planned_km} km planned.</p>
    </article>
    <article class="insight-card">
      <span>This week</span>
      <strong>${p.week_completed_km} / ${p.week_planned_km} km</strong>
      <p>${weekDone} of ${selectedWeekRows.length} sessions are marked done in the selected week.</p>
    </article>
    <article class="insight-card">
      <span>Adherence</span>
      <strong>${p.adherence_pct}%</strong>
      <p>${p.adherence_pct > 100 ? "Logged ahead of the plan to date." : "Compared with planned distance to date."}</p>
    </article>
    <article class="insight-card">
      <span>Longest session</span>
      <strong>${p.longest_km} km</strong>
      <p>Longest completed session logged so far.</p>
    </article>
    <article class="insight-card">
      <span>Back-to-back</span>
      <strong>${p.back_to_back_km} km</strong>
      <p>Best completed pair on consecutive calendar days.</p>
    </article>
    <article class="insight-card">
      <span>Next long effort</span>
      <strong>${nextLong ? `${nextLong.distance_km} km` : "Done"}</strong>
      <p>${nextLong ? `${formatDate(nextLong.date)} · ${nextLong.session}` : "No future long sessions remaining."}</p>
    </article>
  `;
}

function renderKitView() {
  if (!kitView) return;
  const rows = weekRows();
  kitView.innerHTML = "";

  rows.forEach((row) => {
    const item = document.createElement("article");
    item.className = "kit-item";
    if (row.date === state.selectedDate) item.classList.add("is-today");
    item.innerHTML = `
      <div>
        <span>${formatDate(row.date)}</span>
        <strong>${row.session}</strong>
      </div>
      <div>
        <span>Equipment</span>
        <p>${row.equipment || "None"}</p>
      </div>
      <div>
        <span>Fuel</span>
        <p>${row.fuel || "None"}</p>
      </div>
    `;
    item.addEventListener("click", () => {
      state.selectedDate = row.date;
      datePicker.value = row.date;
      render();
    });
    kitView.appendChild(item);
  });
}

function renderTable() {
  const rows = rowsForMode();
  planBody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    if (row.done) tr.classList.add("done");
    if (row.date === state.selectedDate) tr.classList.add("is-today");

    tr.innerHTML = `
      <td><input type="checkbox" ${row.done ? "checked" : ""} aria-label="Done ${row.date}"></td>
      <td><strong>${formatDate(row.date)}</strong><br>W${row.week}</td>
      <td><strong>${row.distance_km || 0}</strong></td>
      <td>${row.type}</td>
      <td>${row.session}<br><span>${row.coach_note || ""}</span></td>
      <td>${row.duration}</td>
      <td>${row.equipment}</td>
      <td>${row.fuel}</td>
    `;

    tr.querySelector("input").addEventListener("change", async (event) => {
      event.stopPropagation();
      const saved = await api(`/log/${row.date}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          done: event.target.checked,
          completed_km: row.completed_km ?? null,
          readiness: row.readiness || "green",
          notes: row.notes || "",
        }),
      });
      row.done = Boolean(saved.done);
      if (row.date === state.selectedDate) doneToggle.checked = row.done;
      render();
      refreshProgress();
    });

    tr.addEventListener("click", (event) => {
      if (event.target.tagName === "INPUT") return;
      state.selectedDate = row.date;
      datePicker.value = row.date;
      render();
    });

    planBody.appendChild(tr);
  });
}

async function refreshProgress() {
  const p = await api("/progress");
  state.progress = p;
  $("#pgCompleted").textContent = `${p.total_completed_km} km`;
  $("#pgPlanned").textContent = `${p.total_planned_km} km`;
  $("#pgAdherence").textContent = `${p.adherence_pct}%`;
  $("#pgWeek").textContent = `${p.week_completed_km} / ${p.week_planned_km} km`;
  $("#pgLongest").textContent = `${p.longest_km} km`;
  $("#pgBackToBack").textContent = `${p.back_to_back_km} km`;
  renderProgressView();
}

async function renderWeekBriefing() {
  const row = selectedRow();
  if (!row) return;
  const data = await api(`/week/${row.week}`);
  $("#briefWeek").textContent = data.briefing.week;
  $("#briefFocus").textContent = data.briefing.focus;
  $("#briefText").textContent = data.briefing.briefing;
  $("#briefTargets").textContent =
    `Target ${data.briefing.target_km} km · logged ${data.completed_km} of ${data.planned_km} km this week.`;
}

function render() {
  renderViewPanels();
  renderWeekNav();
  renderToday();
  renderCalendar();
  renderTable();
  renderProgressView();
  renderKitView();
  renderWeekBriefing();
}

// --- events ---

datePicker.addEventListener("change", () => {
  state.selectedDate = datePicker.value;
  state.mode = "week";
  render();
});

prevWeek.addEventListener("click", () => shiftWeek(-7));
nextWeek.addEventListener("click", () => shiftWeek(7));

$("#todayButton").addEventListener("click", () => {
  state.selectedDate = todayIso();
  if (!state.plan.some((r) => r.date === state.selectedDate)) {
    state.selectedDate = state.plan[0].date;
  }
  datePicker.value = state.selectedDate;
  state.mode = "today";
  render();
});

$("#weekButton").addEventListener("click", () => {
  state.mode = "week";
  render();
});

$("#allButton").addEventListener("click", () => {
  state.mode = "all";
  render();
});

searchInput.addEventListener("input", () => {
  state.query = searchInput.value.trim();
  renderCalendar();
  renderTable();
});

$$("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    if (state.view !== "calendar" && state.query) {
      state.query = "";
      searchInput.value = "";
    }
    if (state.view === "plan" && state.mode === "today") {
      state.mode = "week";
    }
    render();
  });
});

doneToggle.addEventListener("change", saveSelected);
actualKm.addEventListener("change", saveSelected);
readinessSelect.addEventListener("change", () => {
  renderAdaptation();
  saveSelected();
});
noteBox.addEventListener("input", saveSelectedDebounced);

// --- boot ---

async function boot() {
  try {
    const [coach, client, plan] = await Promise.all([
      api("/coach"),
      api("/client"),
      api("/plan"),
    ]);

    $("#coachTitle").textContent = coach.title;
    $("#coachName").textContent = coach.name;
    $("#clientLine").textContent = "Thames Path Ultra";
    $("#coachBio").textContent = coach.bio;
    $("#coachPhilosophy").textContent = coach.philosophy;
    $("#daysToEvent").textContent = client.days_to_event;

    state.plan = plan;
    if (!state.plan.some((row) => row.date === state.selectedDate)) {
      state.selectedDate = state.plan[0].date;
    }
    datePicker.min = state.plan[0].date;
    datePicker.max = state.plan[state.plan.length - 1].date;
    datePicker.value = state.selectedDate;

    render();
    refreshProgress();
    showVersion();
  } catch (err) {
    $("#todayTitle").textContent = "Cannot reach the coach";
    $("#todayMeta").textContent = "Start the app: docker compose up --build (or uvicorn backend.main:app)";
  }
}

async function showVersion() {
  const el = $("#appVersion");
  if (!el) return;
  try {
    const { version } = await api("/version");
    el.textContent = version === "dev" ? "dev" : version.slice(0, 7);
  } catch {
    el.textContent = "?";
  }
}

boot();
