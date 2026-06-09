/* Dependency-free SVG charts. Builders return markup strings; the route map
   renders into a live element because it needs path measurement. */

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

export const TYPE_COLOURS = {
  easy: "var(--easy)",
  long: "var(--long)",
  strength: "var(--strength)",
  recovery: "var(--recovery)",
  rest: "var(--rest)",
  mobility: "var(--mobility)",
  other: "var(--other)",
};

/* Seven day bars for the dashboard "this week" tile. */
export function weekMiniBars(rows, typeKeyOf) {
  const W = 220;
  const H = 56;
  const max = Math.max(...rows.map((r) => r.distance_km || 0), 1);
  const bw = W / 7 - 6;
  const bars = rows
    .map((row, i) => {
      const km = row.distance_km || 0;
      const h = km > 0 ? Math.max(6, (km / max) * (H - 14)) : 4;
      const x = i * (W / 7) + 3;
      const colour = TYPE_COLOURS[typeKeyOf(row)];
      const opacity = row.done ? 1 : 0.35;
      return `<rect x="${x}" y="${H - h - 12}" width="${bw}" height="${h}" rx="3"
        fill="${colour}" opacity="${opacity}"><title>${esc(row.date)}: ${km} km${row.done ? " (done)" : ""}</title></rect>
        <text x="${x + bw / 2}" y="${H - 1}" text-anchor="middle">${"MTWTFSS"[i]}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${bars}</svg>`;
}

/* Small acute-load sparkline for the freshness tile. */
export function sparkline(values) {
  const W = 220;
  const H = 44;
  if (!values.length) return "";
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(H - 4 - (v / max) * (H - 10)).toFixed(1)}`)
    .join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
  </svg>`;
}

/* 14 weekly bars: planned as a track, completed as the fill. */
export function weeklyBars(weeks) {
  const W = 720;
  const H = 210;
  const pad = { l: 34, r: 8, t: 14, b: 26 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const max = Math.max(...weeks.map((w) => Math.max(w.planned_km, w.completed_km)), 1);
  const slot = innerW / weeks.length;
  const bw = Math.min(34, slot - 10);

  const bars = weeks
    .map((w, i) => {
      const x = pad.l + i * slot + (slot - bw) / 2;
      const ph = (w.planned_km / max) * innerH;
      const ch = (w.completed_km / max) * innerH;
      const over = w.completed_km > w.planned_km * 1.15;
      const current = w.is_current ? ` font-weight="700" fill="var(--accent)"` : "";
      return `
        <rect class="bar-track" x="${x}" y="${pad.t + innerH - ph}" width="${bw}" height="${Math.max(ph, 1)}" rx="4"/>
        <rect class="bar-fill${over ? " over" : ""}" x="${x}" y="${pad.t + innerH - ch}" width="${bw}" height="${Math.max(ch, 0)}" rx="4">
          <title>Week ${w.week}: ${w.completed_km} of ${w.planned_km} km</title></rect>
        <text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle"${current}>W${w.week}</text>`;
    })
    .join("");

  const gridlines = [0.5, 1]
    .map((f) => {
      const y = pad.t + innerH - innerH * f;
      return `<line class="axis" x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}"/>
        <text x="${pad.l - 6}" y="${y + 4}" text-anchor="end">${Math.round(max * f)}</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
    aria-label="Weekly planned versus completed kilometres">${gridlines}${bars}</svg>`;
}

/* Cumulative plan-vs-actual lines. */
export function cumulativeChart(cumulative) {
  const W = 720;
  const H = 230;
  const pad = { l: 40, r: 10, t: 12, b: 24 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const max = Math.max(...cumulative.map((c) => c.planned_km), 1);
  const n = cumulative.length;
  const x = (i) => pad.l + (i / (n - 1)) * innerW;
  const y = (v) => pad.t + innerH - (v / max) * innerH;

  const planned = cumulative.map((c, i) => `${x(i).toFixed(1)},${y(c.planned_km).toFixed(1)}`).join(" ");
  const actualPts = cumulative.filter((c) => c.completed_km !== null);
  const actual = actualPts.map((c) => `${x(cumulative.indexOf(c)).toFixed(1)},${y(c.completed_km).toFixed(1)}`).join(" ");
  const lastActual = actualPts[actualPts.length - 1];
  const area = actual
    ? `M ${actual.split(" ")[0]} L ${actual.split(" ").join(" L ")} L ${x(cumulative.indexOf(lastActual)).toFixed(1)},${y(0)} L ${x(0)},${y(0)} Z`
    : "";

  const gridlines = [0.25, 0.5, 0.75, 1]
    .map((f) => {
      const gy = y(max * f);
      return `<line class="axis" x1="${pad.l}" y1="${gy}" x2="${W - pad.r}" y2="${gy}"/>
        <text x="${pad.l - 6}" y="${gy + 4}" text-anchor="end">${Math.round(max * f)}</text>`;
    })
    .join("");

  const marker = lastActual
    ? `<circle cx="${x(cumulative.indexOf(lastActual))}" cy="${y(lastActual.completed_km)}" r="4" fill="var(--accent)"/>
       <text x="${Math.min(x(cumulative.indexOf(lastActual)) + 8, W - 60)}" y="${y(lastActual.completed_km) - 8}" fill="var(--accent)">${lastActual.completed_km} km</text>`
    : "";

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
    aria-label="Cumulative kilometres, plan versus actual">
    ${gridlines}
    <polyline class="line-planned" points="${planned}" stroke-width="2"/>
    ${area ? `<path class="area-actual" d="${area}"/>` : ""}
    ${actual ? `<polyline class="line-actual" points="${actual}" stroke-width="2.5"/>` : ""}
    ${marker}
  </svg>`;
}

/* Acute:chronic ratio over time with the 0.8-1.3 "safe" band. */
export function loadChart(series) {
  const W = 720;
  const H = 190;
  const pad = { l: 34, r: 10, t: 12, b: 24 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const maxRatio = 2;
  const pts = series.filter((s) => s.ratio !== null);
  if (pts.length < 2) {
    return `<p class="muted-block" style="padding:4px 0 10px">Not enough logged sessions yet — the load ratio appears once a week or two of training is in the legs.</p>`;
  }
  const n = series.length;
  const x = (i) => pad.l + (i / (n - 1)) * innerW;
  const y = (v) => pad.t + innerH - (Math.min(v, maxRatio) / maxRatio) * innerH;

  const line = pts.map((s) => `${x(series.indexOf(s)).toFixed(1)},${y(s.ratio).toFixed(1)}`).join(" ");
  const band = `<rect class="ratio-band" x="${pad.l}" y="${y(1.3)}" width="${innerW}" height="${y(0.8) - y(1.3)}"/>`;
  const gridlines = [0.8, 1, 1.3]
    .map((v) => `<line class="axis" x1="${pad.l}" y1="${y(v)}" x2="${W - pad.r}" y2="${y(v)}"/>
      <text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`)
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
    aria-label="Acute to chronic training load ratio">${band}${gridlines}
    <polyline class="line-ratio" points="${line}" stroke-width="2.5"/>
  </svg>`;
}

/* The Thames journey map: training progress mapped onto the 100 km course. */
const WAYPOINTS = [
  ["Putney", 0],
  ["Richmond", 16],
  ["Hampton Court", 28],
  ["Runnymede", 50],
  ["Windsor", 61],
  ["Henley", 100],
];

export function renderRouteMap(el, fraction) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  el.innerHTML = `<svg viewBox="0 0 1000 130" preserveAspectRatio="xMidYMid meet">
    <path class="route-track" d="M 20 78 C 150 30, 260 108, 380 72 S 600 22, 720 72 S 920 100, 980 52"
      pathLength="100" fill="none" stroke-width="7" stroke-linecap="round"/>
    <path class="route-progress" d="M 20 78 C 150 30, 260 108, 380 72 S 600 22, 720 72 S 920 100, 980 52"
      pathLength="100" fill="none" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="${pct.toFixed(2)} 100"/>
    <g class="route-points"></g>
  </svg>`;

  const svg = el.querySelector("svg");
  const track = el.querySelector(".route-track");
  const group = el.querySelector(".route-points");
  const total = track.getTotalLength();
  const ns = "http://www.w3.org/2000/svg";

  WAYPOINTS.forEach(([name, km], i) => {
    const p = track.getPointAtLength((km / 100) * total);
    const reached = pct >= km;
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", p.x);
    dot.setAttribute("cy", p.y);
    dot.setAttribute("r", 5);
    dot.setAttribute("fill", reached ? "var(--accent)" : "var(--line)");
    dot.setAttribute("stroke", "var(--surface)");
    dot.setAttribute("stroke-width", 2);
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", p.x);
    label.setAttribute("y", i % 2 ? p.y - 14 : p.y + 24);
    label.setAttribute("text-anchor", km === 0 ? "start" : km === 100 ? "end" : "middle");
    if (reached) label.setAttribute("class", "done");
    label.textContent = `${name} ${km}`;
    group.append(dot, label);
  });

  const m = track.getPointAtLength((pct / 100) * total);
  const marker = document.createElementNS(ns, "circle");
  marker.setAttribute("cx", m.x);
  marker.setAttribute("cy", m.y);
  marker.setAttribute("r", 8);
  marker.setAttribute("fill", "var(--accent)");
  marker.setAttribute("stroke", "var(--surface)");
  marker.setAttribute("stroke-width", 3);
  svg.append(marker);
}

export function nearestWaypoint(fraction) {
  const km = Math.max(0, Math.min(1, fraction)) * 100;
  let best = WAYPOINTS[0];
  for (const wp of WAYPOINTS) if (Math.abs(wp[1] - km) < Math.abs(best[1] - km)) best = wp;
  return { name: best[0], km: Math.round(km) };
}
