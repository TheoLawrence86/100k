export const state = {
  plan: [],
  view: "dashboard",
  mode: "week", // plan table: "week" | "all"
  selectedDate: todayIso(),
  query: "",
  client: null,
  progress: null,
  load: null,
  kit: [],
};

export function todayIso() {
  const now = new Date();
  return isoFromDate(now);
}

export function isoFromDate(date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

export function formatDate(iso) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(`${iso}T12:00:00`));
}

export function formatShortDate(iso) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  }).format(new Date(`${iso}T12:00:00`));
}

export function weekBounds() {
  const selected = new Date(`${state.selectedDate}T12:00:00`);
  const day = selected.getDay() || 7;
  const monday = new Date(selected);
  monday.setDate(selected.getDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { monday, sunday };
}

export function weekRows() {
  const { monday, sunday } = weekBounds();
  return state.plan.filter((row) => {
    const date = new Date(`${row.date}T12:00:00`);
    return date >= monday && date <= sunday;
  });
}

export function selectedRow() {
  return state.plan.find((row) => row.date === state.selectedDate) || state.plan[0];
}

export function rowDistance(row) {
  return Number.parseFloat(row.distance_km || "0") || 0;
}

const TYPE_KEYS = ["long", "strength", "recovery", "rest", "mobility", "easy"];

export function typeKey(row) {
  const text = `${row.type || ""} ${row.session || ""}`.toLowerCase();
  return TYPE_KEYS.find((key) => text.includes(key)) || "other";
}
