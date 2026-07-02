import { api } from "./api.js";
import { state, selectedRow, rowDistance, formatDate } from "./state.js";
import { buildMapStyle } from "./mapstyle.js";

const $ = (sel) => document.querySelector(sel);

/* Module state for the route view: the MapLibre map survives view switches,
   the last plotted route feeds the GPX download. */
let map = null;
let startMarker = null;
let lastRoute = null;
let mapTheme = null;
let seed = 0;
let busy = false;

/* Manual start: set by dragging the pin or dropping it on the map. Browsers
   without GPS often only know the town (or the ISP's city), so a bad fix
   only needs correcting once — the start is remembered across visits. */
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

const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const currentTheme = () =>
  document.documentElement.dataset.theme === "dark" ? "dark" : "light";

function routeGeojson() {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      // API sends [lat, lon]; MapLibre wants [lng, lat].
      coordinates: lastRoute ? lastRoute.coords.map(([lat, lon]) => [lon, lat]) : [],
    },
  };
}

/* setStyle wipes sources and layers, so the route is re-added on every
   style.load — initial load and theme swaps alike. */
function addRouteLayers() {
  if (map.getSource("route")) return;
  map.addSource("route", { type: "geojson", data: routeGeojson() });
  map.addLayer({
    id: "route-casing", type: "line", source: "route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": cssVar("--ink"), "line-width": 7, "line-opacity": 0.25 },
  });
  map.addLayer({
    id: "route-line", type: "line", source: "route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": cssVar("--accent"), "line-width": 3.5 },
  });
}

function ensureMap() {
  if (map) {
    if (mapTheme !== currentTheme()) {
      mapTheme = currentTheme();
      map.setStyle(buildMapStyle(mapTheme));
    }
    return map;
  }
  mapTheme = currentTheme();
  map = new maplibregl.Map({
    container: "loopMap",
    style: buildMapStyle(mapTheme),
    center: pinnedStart ? [pinnedStart.lon, pinnedStart.lat] : [-1.5, 52.5],
    zoom: pinnedStart ? 13 : 5.2,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
  map.on("style.load", addRouteLayers);
  return map;
}

function setStartMarker(lat, lon) {
  const m = ensureMap();
  if (!startMarker) {
    startMarker = new maplibregl.Marker({ draggable: true, color: cssVar("--accent") })
      .setLngLat([lon, lat])
      .addTo(m);
    startMarker.on("dragend", () => {
      const p = startMarker.getLngLat();
      pinnedStart = { lat: p.lat, lon: p.lng };
      localStorage.setItem("routeStart", JSON.stringify(pinnedStart));
      generate();
    });
  } else {
    startMarker.setLngLat([lon, lat]);
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
  const source = m.getSource("route");
  if (source) source.setData(routeGeojson());
  const lngs = route.coords.map(([, lon]) => lon);
  const lats = route.coords.map(([lat]) => lat);
  m.fitBounds(
    [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
    { padding: 36, duration: 700 }
  );
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
          `drag the pin (or “Drop pin on map”) and I'll replot.`;
      }
    }
    setStartMarker(start.lat, start.lon);
    setStatus(`Plotting a ${km} km loop on real footpaths…`);
    const route = await api(`/route?lat=${start.lat}&lon=${start.lon}&km=${km}&seed=${seed}`);
    lastRoute = route;
    drawRoute(route);
    $("#routeActual").textContent = `${route.actual_km} km`;
    $("#routeGpx").disabled = false;
    $("#routeGpxFile").disabled = false;
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
          "Drag the pin to your start point (or use “Drop pin on map”) and I'll plot from there.",
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
  pinnedStart = { lat: e.lngLat.lat, lon: e.lngLat.lng };
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
  m.getCanvas().style.cursor = "";
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
  m.getCanvas().style.cursor = "crosshair";
  setStatus("Tap the map where your run starts — zoom and pan first if you need to.");
}

function buildGpx() {
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
  return { gpx, name: `loop-${lastRoute.actual_km}km.gpx` };
}

// Save the GPX straight to disk / the Files app. This is the reliable path:
// some watch nav apps only register a Files "import" hook and never show up
// in the iOS share sheet, so we always offer a plain download too.
function saveGpxFile() {
  if (!lastRoute) return;
  const { gpx, name } = buildGpx();
  const url = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

async function shareGpx() {
  if (!lastRoute) return;
  const { gpx, name } = buildGpx();
  // On the phone, the share sheet can hand the GPX straight to a watch nav app
  // (WorkOutDoors, Komoot, Footpath…) — no detour through the Files app.
  const file = new File([gpx], name, { type: "application/gpx+xml" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err.name === "AbortError") return; // athlete closed the sheet
      // Share failed for real — fall through to the plain download.
    }
  }
  saveGpxFile();
}

export function wireRouteView() {
  $("#routeGo").addEventListener("click", () => { seed = 0; generate(); });
  $("#routeReroll").addEventListener("click", () => { seed += 1; generate(); });
  $("#routeLocate").addEventListener("click", useMyLocation);
  $("#routeDrop").addEventListener("click", toggleDropPin);
  const gpxBtn = $("#routeGpx");
  const fileBtn = $("#routeGpxFile");
  gpxBtn.addEventListener("click", shareGpx);
  fileBtn.addEventListener("click", saveGpxFile);
  const probe = new File([""], "probe.gpx", { type: "application/gpx+xml" });
  // Only expose the share button where file-sharing actually works (mainly the
  // phone). On desktop it's unsupported, so the share button just hides and the
  // plain "Save GPX file" button carries the load.
  if (navigator.canShare?.({ files: [probe] })) {
    gpxBtn.textContent = "Send GPX to watch app";
  } else {
    gpxBtn.hidden = true;
  }
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

  // The map measures its container, so wait until the view is visible.
  // ensureMap() also re-skins the basemap if the theme changed meanwhile.
  requestAnimationFrame(() => {
    ensureMap().resize();
    // First visit to the view: simulate the run automatically.
    if (!lastRoute && !busy && kmInput.value) generate();
  });
}
