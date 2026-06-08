const planUrl = "data/training-plan.tsv?v=coach-2";
const state = {
  plan: [],
  mode: "week",
  selectedDate: todayIso(),
  query: "",
};

const datePicker = document.querySelector("#datePicker");
const todayButton = document.querySelector("#todayButton");
const weekButton = document.querySelector("#weekButton");
const allButton = document.querySelector("#allButton");
const searchInput = document.querySelector("#searchInput");
const statusSelect = document.querySelector("#statusSelect");
const planBody = document.querySelector("#planBody");
const noteBox = document.querySelector("#noteBox");
const adapt = document.querySelector(".adapt");

function todayIso() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function parseTsv(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split("\t");
  return lines.map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
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

function selectedWeekTotal() {
  return weekRows().reduce((total, row) => total + rowDistance(row), 0);
}

function rowsForMode() {
  let rows = state.mode === "all" ? state.plan : state.mode === "today" ? [selectedRow()] : weekRows();
  if (state.query) {
    const query = state.query.toLowerCase();
    rows = rows.filter((row) => Object.values(row).join(" ").toLowerCase().includes(query));
  }
  return rows;
}

function doneKey(date) {
  return `done:${date}`;
}

function noteKey(date) {
  return `note:${date}`;
}

function renderToday() {
  const row = selectedRow();
  const distance = rowDistance(row);
  document.querySelector("#todayTitle").textContent = row.session;
  document.querySelector("#todayMeta").textContent = `${formatDate(row.date)} - Week ${row.week} - ${row.phase} - ${selectedWeekTotal()} km week`;
  document.querySelector("#todayDistance").textContent = distance ? `${distance} km` : "0 km";
  document.querySelector("#todayDuration").textContent = row.duration;
  document.querySelector("#todayEquipment").textContent = row.equipment;
  document.querySelector("#todayFuel").textContent = row.fuel;
  document.querySelector("#todayCoach").textContent = row.coach || row.notes || "";
  noteBox.value = localStorage.getItem(noteKey(row.date)) || "";
}

function renderAdaptation() {
  const value = statusSelect.value;
  adapt.className = `adapt ${value}`;
  const title = document.querySelector("#adaptTitle");
  const text = document.querySelector("#adaptText");
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
    const done = localStorage.getItem(doneKey(row.date)) === "1";
    if (done) tr.classList.add("done");
    if (row.date === state.selectedDate) tr.classList.add("is-today");

    tr.innerHTML = `
      <td><input type="checkbox" ${done ? "checked" : ""} aria-label="Done ${row.date}"></td>
      <td><strong>${formatDate(row.date)}</strong><br>W${row.week}</td>
      <td><strong>${row.distance_km || 0}</strong></td>
      <td>${row.type}</td>
      <td>${row.session}<br><span>${row.coach || row.notes || ""}</span></td>
      <td>${row.duration}</td>
      <td>${row.equipment}</td>
      <td>${row.fuel}</td>
    `;

    tr.querySelector("input").addEventListener("change", (event) => {
      if (event.target.checked) {
        localStorage.setItem(doneKey(row.date), "1");
      } else {
        localStorage.removeItem(doneKey(row.date));
      }
      renderTable();
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

function render() {
  renderToday();
  renderAdaptation();
  renderTable();
}

datePicker.addEventListener("change", () => {
  state.selectedDate = datePicker.value;
  state.mode = "week";
  render();
});

todayButton.addEventListener("click", () => {
  state.selectedDate = todayIso();
  datePicker.value = state.selectedDate;
  state.mode = "today";
  render();
});

weekButton.addEventListener("click", () => {
  state.mode = "week";
  render();
});

allButton.addEventListener("click", () => {
  state.mode = "all";
  render();
});

searchInput.addEventListener("input", () => {
  state.query = searchInput.value.trim();
  renderTable();
});

statusSelect.addEventListener("change", renderAdaptation);

noteBox.addEventListener("input", () => {
  const row = selectedRow();
  localStorage.setItem(noteKey(row.date), noteBox.value);
});

fetch(planUrl, { cache: "no-store" })
  .then((response) => response.text())
  .then((text) => {
    state.plan = parseTsv(text);
    if (!state.plan.some((row) => row.date === state.selectedDate)) {
      state.selectedDate = state.plan[0].date;
    }
    datePicker.min = state.plan[0].date;
    datePicker.max = state.plan[state.plan.length - 1].date;
    datePicker.value = state.selectedDate;
    render();
  })
  .catch(() => {
    document.querySelector("#todayTitle").textContent = "Start a local server";
    document.querySelector("#todayMeta").textContent = "Run: python3 -m http.server 5173";
  });
