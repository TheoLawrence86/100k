const state = {
  plan: [],
  mode: "week",
  selectedDate: todayIso(),
  query: "",
};

const $ = (sel) => document.querySelector(sel);
const datePicker = $("#datePicker");
const searchInput = $("#searchInput");
const planBody = $("#planBody");
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

function selectedRow() {
  return state.plan.find((row) => row.date === state.selectedDate) || state.plan[0];
}

function rowDistance(row) {
  return Number.parseFloat(row.distance_km || "0") || 0;
}

function weekRows() {
  const selected = new Date(`${state.selectedDate}T12:00:00`);
  const day = selected.getDay() || 7;
  const monday = new Date(selected);
  monday.setDate(selected.getDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return state.plan.filter((row) => {
    const date = new Date(`${row.date}T12:00:00`);
    return date >= monday && date <= sunday;
  });
}

function rowsForMode() {
  let rows = state.mode === "all" ? state.plan : state.mode === "today" ? [selectedRow()] : weekRows();
  if (state.query) {
    const query = state.query.toLowerCase();
    rows = rows.filter((row) => Object.values(row).join(" ").toLowerCase().includes(query));
  }
  return rows;
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
  renderTable();
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
      renderTable();
      refreshProgress();
    });

    tr.addEventListener("click", (event) => {
      if (event.target.tagName === "INPUT") return;
      state.selectedDate = row.date;
      datePicker.value = row.date;
      renderToday();
      renderTable();
    });

    planBody.appendChild(tr);
  });
}

async function refreshProgress() {
  const p = await api("/progress");
  $("#pgCompleted").textContent = `${p.total_completed_km} km`;
  $("#pgPlanned").textContent = `${p.total_planned_km} km`;
  $("#pgAdherence").textContent = `${p.adherence_pct}%`;
  $("#pgWeek").textContent = `${p.week_completed_km} / ${p.week_planned_km} km`;
  $("#pgLongest").textContent = `${p.longest_km} km`;
  $("#pgBackToBack").textContent = `${p.back_to_back_km} km`;
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
  renderToday();
  renderTable();
  renderWeekBriefing();
}

// --- events ---

datePicker.addEventListener("change", () => {
  state.selectedDate = datePicker.value;
  state.mode = "week";
  render();
});

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
  renderTable();
});

$("#allButton").addEventListener("click", () => {
  state.mode = "all";
  renderTable();
});

searchInput.addEventListener("input", () => {
  state.query = searchInput.value.trim();
  renderTable();
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
    $("#clientLine").textContent = `Coaching ${client.name} to the ${client.event}`;
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
  } catch (err) {
    $("#todayTitle").textContent = "Cannot reach the coach";
    $("#todayMeta").textContent = "Start the app: docker compose up --build (or uvicorn backend.main:app)";
  }
}

boot();
