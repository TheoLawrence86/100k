import { api, saveLog, saveKit } from "./api.js";
import { state, todayIso, selectedRow } from "./state.js";
import {
  renderChrome,
  renderDashboard,
  renderBrief,
  renderCalendar,
  renderWeekBriefing,
  renderTable,
  renderProgress,
  renderKit,
} from "./views.js";
import { renderRoute, wireRouteView } from "./route.js";

const $ = (sel) => document.querySelector(sel);

/* ---------- render ---------- */

function render() {
  renderChrome();
  if (state.view === "dashboard") renderDashboard();
  if (state.view === "calendar") renderCalendar(ctx);
  if (state.view === "plan") renderTable(ctx);
  if (state.view === "route") renderRoute();
  if (state.view === "progress") renderProgress();
  if (state.view === "kit") renderKit(ctx);
}

function transitionRender() {
  if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.startViewTransition(render);
  } else {
    render();
  }
}

/* ---------- data refresh ---------- */

async function refreshBrief() {
  try {
    state.brief = await api(`/brief?for_date=${state.selectedDate}`);
  } catch {
    state.brief = null;
  }
  if (state.view === "dashboard") renderBrief();
}

async function refreshProgress() {
  const [progress, load] = await Promise.all([api("/progress"), api("/load")]);
  state.progress = progress;
  state.load = load;
  if (state.view === "dashboard") renderDashboard();
  if (state.view === "progress") renderProgress();
}

let briefingRequest = 0;
async function loadWeekBriefing() {
  const row = selectedRow();
  if (!row) return;
  const token = ++briefingRequest;
  const data = await api(`/week/${row.week}`);
  if (token === briefingRequest) renderWeekBriefing(data);
}

/* ---------- shared actions (passed to views) ---------- */

const ctx = {
  select(dateIso) {
    state.selectedDate = dateIso;
    $("#datePicker").value = dateIso;
    render();
    refreshBrief();
  },

  async toggleDone(row, done) {
    const saved = await saveLog(row.date, {
      done,
      completed_km: row.completed_km ?? null,
      readiness: row.readiness || "green",
      notes: row.notes || "",
    });
    Object.assign(row, {
      done: Boolean(saved.done),
      completed_km: saved.completed_km,
      readiness: saved.readiness,
      notes: saved.notes,
    });
    render();
    refreshProgress();
    refreshBrief();
  },

  async updateKit(item, patch) {
    const saved = await saveKit(item.id, patch);
    Object.assign(item, saved);
    renderKit(ctx);
  },

  loadWeekBriefing,
};

/* ---------- logger ---------- */

function loggerPayload() {
  const value = Number.parseFloat($("#actualKm").value);
  return {
    done: $("#doneToggle").checked,
    completed_km: Number.isFinite(value) ? value : null,
    readiness: $("#readinessSelect").value,
    notes: $("#noteBox").value,
  };
}

async function saveSelected() {
  const row = selectedRow();
  if (!row) return;
  const saved = await saveLog(row.date, loggerPayload());
  Object.assign(row, {
    done: Boolean(saved.done),
    completed_km: saved.completed_km,
    readiness: saved.readiness,
    notes: saved.notes,
  });
  renderDashboard();
  refreshProgress();
  refreshBrief();
}

let noteTimer;
function saveSelectedDebounced() {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(saveSelected, 500);
}

/* ---------- router ---------- */

const VIEWS = new Set(["dashboard", "calendar", "plan", "route", "progress", "kit"]);

function applyRoute() {
  const name = (location.hash.replace(/^#\//, "") || "dashboard").split("?")[0];
  state.view = VIEWS.has(name) ? name : "dashboard";
  transitionRender();
}

/* ---------- theme ---------- */

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
  render(); // route map + charts pick up the new tokens via CSS vars automatically
}

/* ---------- events ---------- */

$("#datePicker").addEventListener("change", () => ctx.select($("#datePicker").value));

$("#todayButton").addEventListener("click", () => {
  let iso = todayIso();
  if (!state.plan.some((r) => r.date === iso)) iso = state.plan[0].date;
  ctx.select(iso);
});

$("#prevWeek").addEventListener("click", () => shiftWeek(-7));
$("#nextWeek").addEventListener("click", () => shiftWeek(7));

function shiftWeek(deltaDays) {
  if (!state.plan.length) return;
  const base = new Date(`${state.selectedDate}T12:00:00`);
  base.setDate(base.getDate() + deltaDays);
  let iso = base.toISOString().slice(0, 10);
  const min = state.plan[0].date;
  const max = state.plan[state.plan.length - 1].date;
  if (iso < min) iso = min;
  if (iso > max) iso = max;
  ctx.select(iso);
}

$("#searchInput").addEventListener("input", () => {
  state.query = $("#searchInput").value.trim();
  if (state.view === "calendar") renderCalendar(ctx);
  if (state.view === "plan") renderTable(ctx);
});

$("#weekButton").addEventListener("click", () => { state.mode = "week"; renderTable(ctx); });
$("#allButton").addEventListener("click", () => { state.mode = "all"; renderTable(ctx); });

$("#doneToggle").addEventListener("change", saveSelected);
$("#actualKm").addEventListener("change", saveSelected);
$("#readinessSelect").addEventListener("change", saveSelected);
$("#noteBox").addEventListener("input", saveSelectedDebounced);

$("#themeToggle").addEventListener("click", toggleTheme);

wireRouteView();

window.addEventListener("hashchange", applyRoute);

/* ---------- boot ---------- */

async function boot() {
  try {
    const [coach, client, plan, kit] = await Promise.all([
      api("/coach"),
      api("/client"),
      api("/plan"),
      api("/kit"),
    ]);

    $("#coachName").textContent = coach.name;
    $("#coachTitle").textContent = coach.title;
    $("#coachBio").textContent = coach.bio;
    $("#coachPhilosophy").textContent = coach.philosophy;

    state.client = client;
    state.plan = plan;
    state.kit = kit;
    if (!state.plan.some((row) => row.date === state.selectedDate)) {
      state.selectedDate = state.plan[0].date;
    }
    const picker = $("#datePicker");
    picker.min = state.plan[0].date;
    picker.max = state.plan[state.plan.length - 1].date;
    picker.value = state.selectedDate;

    applyRoute();
    await refreshProgress();
    refreshBrief();
    showVersion();
  } catch (err) {
    $("#todayTitle").textContent = "Cannot reach the coach";
    $("#todayMeta").textContent =
      "Start the app: docker compose up --build (or uvicorn backend.main:app)";
  }
}

async function showVersion() {
  const el = $("#appVersion");
  try {
    const { version } = await api("/version");
    el.textContent = version === "dev" ? "dev" : version.slice(0, 7);
  } catch {
    el.textContent = "?";
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

boot();
