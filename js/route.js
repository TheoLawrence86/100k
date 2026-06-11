import { api } from "./api.js";
import { state, selectedRow, rowDistance, formatDate } from "./state.js";

const $ = (sel) => document.querySelector(sel);

/* Module state for the route view: the Leaflet map survives view switches,
   the last plotted route feeds the GPX download. */
let map = null;
let routeLayer = null;
let startMarker = null;
let lastRoute = null;
let seed = 0;
let busy = false;

/* Manual start: set by dragging the pin. Browsers without GPS often only
   know the town (or the ISP's city), so a bad fix only needs correcting
   once — the pinned start is remembered across visits. */
let pinnedStart = null;
try {
  pinnedStart = JSON.parse(localStorage.getItem("routeStart"));
} catch {
  pinnedStart = null;
}

/* The distance the athlete "needs": today's planned km, or the next
   session with real distance if today is a rest day. */
function neededSession() {
  const row = selectedRow();
  if (row && rowDistance(row) > 0) return row;
  return state.plan.find((r) => r.date >= state.selectedDate && rowDistance(r) > 0) || row;
}

function setStatus(text, tone = "") {
  const el = $("#routeStatus");
  el.textContent = text;
  el.className = `route-status ${tone}`.trim();
}

function ensureMap() {
  if (map) return map;
  map = L.map("loopMap", { zoomControl: true, attributionControl: true });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  if (pinnedStart) {
    map.setView([pinnedStart.lat, pinnedStart.lon], 14);
  } else {
    map.setView([52.5, -1.5], 6); // Britain, until we know better
  }
  return map;
}

function setStartMarker(lat, lon) {
  const m = ensureMap();
  if (!startMarker) {
    startMarker = L.marker([lat, lon], { draggable: true })
      .addTo(m)
      .bindTooltip("Start / finish — drag me if this isn't where you are");
    startMarker.on("dragend", () => {
      const p = startMarker.getLatLng();
      pinnedStart = { lat: p.lat, lon: p.lng };
      localStorage.setItem("routeStart", JSON.stringify(pinnedStart));
      generate();
    });
  } else {
    startMarker.setLatLng([lat, lon]);
  }
}

function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This browser has no geolocation."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy || 0,
        }),
      (err) => reject(new Error(err.message || "Location was refused.")),
      // maximumAge 0: always a fresh fix, never yesterday's cached one.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

function drawRoute(route) {
  const m = ensureMap();
  if (routeLayer) routeLayer.remove();
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim();
  routeLayer = L.layerGroup([
    L.polyline(route.coords, { color: ink, weight: 7, opacity: 0.25 }),
    L.polyline(route.coords, { color: accent, weight: 3.5 }),
  ]).addTo(m);
  m.fitBounds(L.polyline(route.coords).getBounds(), { padding: [28, 28] });
}

function setBusy(value) {
  busy = value;
  ["#routeGo", "#routeReroll", "#routeLocate"].forEach((sel) => {
    $(sel).disabled = value;
  });
}

async function generate() {
  if (busy) return;
  const km = Number.parseFloat($("#routeKm").value);
  if (!Number.isFinite(km) || km <= 0) {
    setStatus("Give me a distance in km first.", "red");
    return;
  }
  setBusy(true);
  try {
    let start = pinnedStart;
    let note = "Wrong spot? Drag the pin and the loop replots.";
    if (start) {
      note = "Starting from your pinned spot — “Use my location” to go back to GPS.";
    } else {
      setStatus("Finding you…");
      start = await locate();
      if (start.accuracy > 2000) {
        note =
          `Heads-up: your browser only knows your position to about ` +
          `${Math.round(start.accuracy / 1000)} km, so the start may be off — ` +
          `drag the pin to where you actually are and I'll replot.`;
      }
    }
    setStartMarker(start.lat, start.lon);
    setStatus(`Plotting a ${km} km loop on real footpaths…`);
    const route = await api(`/route?lat=${start.lat}&lon=${start.lon}&km=${km}&seed=${seed}`);
    lastRoute = route;
    drawRoute(route);
    $("#routeActual").textContent = `${route.actual_km} km`;
    $("#routeGpx").disabled = false;
    const offTarget = Math.abs(route.actual_km - km) / km > 0.2;
    setStatus(
      offTarget
        ? `Closest loop the paths here allow: ${route.actual_km} km against your ${km} km target — try “Deal another” for a different shape. ${note}`
        : `Done: a ${route.actual_km} km loop, back to the same spot. ${note}`
    );
  } catch (err) {
    if (!pinnedStart && !startMarker) {
      // No location and no pin: drop one mid-map and let the athlete place it.
      const centre = ensureMap().getCenter();
      setStartMarker(centre.lat, centre.lng);
      setStatus(
        `Couldn't get your location (${err.message}). ` +
          "Drag the pin to your start point and I'll plot from there.",
        "red"
      );
    } else {
      setStatus(`Couldn't plot a route: ${err.message}`, "red");
    }
  } finally {
    setBusy(false);
  }
}

function useMyLocation() {
  disarmDropPin();
  pinnedStart = null;
  localStorage.removeItem("routeStart");
  generate();
}

/* Drop-pin mode: arm the button, tap the map, the loop plots from there.
   Saves dragging the pin across the country when the browser's location
   guess is a different city. */
let dropArmed = false;

function onDropClick(e) {
  disarmDropPin();
  pinnedStart = { lat: e.latlng.lat, lon: e.latlng.lng };
  localStorage.setItem("routeStart", JSON.stringify(pinnedStart));
  setStartMarker(pinnedStart.lat, pinnedStart.lon);
  generate();
}

function disarmDropPin() {
  if (!dropArmed) return;
  dropArmed = false;
  $("#routeDrop").classList.remove("armed");
  const m = ensureMap();
  m.off("click", onDropClick);
  m.getContainer().style.cursor = "";
}

function toggleDropPin() {
  if (dropArmed) {
    disarmDropPin();
    setStatus("Pin drop cancelled.");
    return;
  }
  dropArmed = true;
  $("#routeDrop").classList.add("armed");
  const m = ensureMap();
  m.once("click", onDropClick);
  m.getContainer().style.cursor = "crosshair";
  setStatus("Tap the map where your run starts — zoom and pan first if you need to.");
}

function downloadGpx() {
  if (!lastRoute) return;
  const pts = lastRoute.coords
    .map(([lat, lon]) => `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`)
    .join("\n");
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Thames Path 100K journal" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Training loop ${lastRoute.actual_km} km</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>`;
  const url = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: `loop-${lastRoute.actual_km}km.gpx`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

export function wireRouteView() {
  $("#routeGo").addEventListener("click", () => { seed = 0; generate(); });
  $("#routeReroll").addEventListener("click", () => { seed += 1; generate(); });
  $("#routeLocate").addEventListener("click", useMyLocation);
  $("#routeDrop").addEventListener("click", toggleDropPin);
  $("#routeGpx").addEventListener("click", downloadGpx);
}

export function renderRoute() {
  const session = neededSession();
  const kmInput = $("#routeKm");
  if (session && rowDistance(session) > 0) {
    if (!kmInput.value) kmInput.value = rowDistance(session);
    const when = session.date === state.selectedDate ? "Today" : formatDate(session.date);
    $("#routeNeed").textContent =
      `${when}: ${session.session} · ${rowDistance(session)} km on the plan.`;
  } else {
    $("#routeNeed").textContent = "Nothing on the plan — pick your own distance.";
  }

  // Leaflet measures its container, so wait until the view is visible.
  requestAnimationFrame(() => {
    ensureMap().invalidateSize();
    // First visit to the view: simulate the run automatically.
    if (!lastRoute && !busy && kmInput.value) generate();
  });
}
