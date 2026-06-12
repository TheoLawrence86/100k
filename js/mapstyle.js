/* A bespoke MapLibre style over OpenFreeMap vector tiles (OpenMapTiles
   schema), drawn in the Towpath Journal palette so the basemap reads as
   part of the print, not an embedded widget. One builder, two palettes:
   the dark theme is the "ink edition" of the same map. */

const PALETTES = {
  light: {
    paper: "#f2e7d3",
    paper2: "#e9dcc2",
    built: "#ece0c8",
    green: "#dde3c3",
    wood: "#cfd9b4",
    water: "#9fbcd8",
    waterInk: "#4a7fb5",
    road: "#faf3e1",
    roadCasing: "#d8c7a1",
    major: "#f3e3bd",
    motorway: "#ecd2a4",
    path: "#a98562",
    rail: "#b3a07e",
    building: "#e2d3b5",
    ink: "#1e3a5f",
    inkSoft: "#5c6f88",
    halo: "#f2e7d3",
  },
  dark: {
    paper: "#14202e",
    paper2: "#182636",
    built: "#1a2939",
    green: "#1b2e33",
    wood: "#1e3438",
    water: "#2a4258",
    waterInk: "#6f9fce",
    road: "#243446",
    roadCasing: "#0e1722",
    major: "#2c3f54",
    motorway: "#3a4e66",
    path: "#7d8aa0",
    rail: "#3e5066",
    building: "#1f2e40",
    ink: "#e9ddc4",
    inkSoft: "#9aa7b5",
    halo: "#14202e",
  },
};

const road = (zMin, wMin, zMax, wMax) => [
  "interpolate", ["exponential", 1.4], ["zoom"], zMin, wMin, zMax, wMax,
];
const classIn = (...classes) => ["in", ["get", "class"], ["literal", classes]];

export function buildMapStyle(theme) {
  const c = PALETTES[theme] || PALETTES.light;
  const src = "openfreemap";
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      [src]: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": c.paper } },

      { id: "landuse-built", type: "fill", source: src, "source-layer": "landuse",
        filter: classIn("residential", "suburb", "neighbourhood", "quarter", "commercial", "industrial", "retail"),
        paint: { "fill-color": c.built } },
      { id: "landcover-grass", type: "fill", source: src, "source-layer": "landcover",
        filter: classIn("grass"),
        paint: { "fill-color": c.green, "fill-opacity": 0.9 } },
      { id: "landcover-wood", type: "fill", source: src, "source-layer": "landcover",
        filter: classIn("wood"),
        paint: { "fill-color": c.wood, "fill-opacity": 0.9 } },
      { id: "park", type: "fill", source: src, "source-layer": "park",
        paint: { "fill-color": c.green, "fill-opacity": 0.75 } },

      { id: "water", type: "fill", source: src, "source-layer": "water",
        filter: ["!=", ["get", "brunnel"], "tunnel"],
        paint: { "fill-color": c.water } },
      { id: "waterway", type: "line", source: src, "source-layer": "waterway",
        paint: { "line-color": c.water, "line-width": road(9, 0.7, 18, 4) } },

      { id: "aeroway", type: "line", source: src, "source-layer": "aeroway",
        minzoom: 11,
        paint: { "line-color": c.paper2, "line-width": road(11, 1, 18, 14) } },

      { id: "building", type: "fill", source: src, "source-layer": "building",
        minzoom: 13,
        paint: { "fill-color": c.building, "fill-opacity": 0.65 } },

      { id: "tunnel", type: "line", source: src, "source-layer": "transportation",
        filter: ["==", ["get", "brunnel"], "tunnel"],
        paint: { "line-color": c.roadCasing, "line-width": road(11, 0.5, 18, 6), "line-dasharray": [2, 2], "line-opacity": 0.5 } },

      { id: "road-minor-casing", type: "line", source: src, "source-layer": "transportation",
        minzoom: 12, filter: classIn("minor", "service"),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.roadCasing, "line-width": road(12, 1, 18, 9), "line-opacity": 0.6 } },
      { id: "road-minor", type: "line", source: src, "source-layer": "transportation",
        minzoom: 12, filter: classIn("minor", "service"),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.road, "line-width": road(12, 0.5, 18, 7.5) } },

      { id: "road-mid-casing", type: "line", source: src, "source-layer": "transportation",
        filter: classIn("tertiary", "secondary"),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.roadCasing, "line-width": road(10, 1.4, 18, 11), "line-opacity": 0.7 } },
      { id: "road-mid", type: "line", source: src, "source-layer": "transportation",
        filter: classIn("tertiary", "secondary"),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.major, "line-width": road(10, 0.8, 18, 9) } },

      { id: "road-major-casing", type: "line", source: src, "source-layer": "transportation",
        filter: classIn("primary", "trunk"),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.roadCasing, "line-width": road(8, 1.6, 18, 13), "line-opacity": 0.7 } },
      { id: "road-major", type: "line", source: src, "source-layer": "transportation",
        filter: classIn("primary", "trunk"),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.major, "line-width": road(8, 1, 18, 11) } },

      { id: "road-motorway", type: "line", source: src, "source-layer": "transportation",
        filter: classIn("motorway"),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.motorway, "line-width": road(6, 1, 18, 12) } },

      /* The layer a runner actually reads: footpaths and tracks, dashed
         in towpath brown so they stand out from the road grid. */
      { id: "path", type: "line", source: src, "source-layer": "transportation",
        minzoom: 12, filter: classIn("path", "track", "pedestrian"),
        paint: { "line-color": c.path, "line-width": road(12, 0.6, 18, 2.6), "line-dasharray": [2.2, 1.6] } },

      { id: "rail", type: "line", source: src, "source-layer": "transportation",
        minzoom: 10, filter: classIn("rail"),
        paint: { "line-color": c.rail, "line-width": road(10, 0.6, 18, 2.2), "line-dasharray": [4, 2.5] } },

      { id: "boundary", type: "line", source: src, "source-layer": "boundary",
        filter: ["all", ["<=", ["get", "admin_level"], 6], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": c.inkSoft, "line-width": 1, "line-dasharray": [3, 2], "line-opacity": 0.4 } },

      { id: "road-name", type: "symbol", source: src, "source-layer": "transportation_name",
        minzoom: 14,
        layout: {
          "symbol-placement": "line",
          "text-font": ["Noto Sans Regular"],
          "text-field": ["get", "name"],
          "text-size": road(14, 10, 18, 13),
        },
        paint: { "text-color": c.inkSoft, "text-halo-color": c.halo, "text-halo-width": 1.2 } },

      { id: "water-name", type: "symbol", source: src, "source-layer": "water_name",
        layout: {
          "symbol-placement": "line",
          "text-font": ["Noto Sans Italic"],
          "text-field": ["get", "name"],
          "text-size": 12,
          "text-letter-spacing": 0.15,
        },
        paint: { "text-color": c.waterInk, "text-halo-color": c.halo, "text-halo-width": 1 } },

      { id: "place-minor", type: "symbol", source: src, "source-layer": "place",
        minzoom: 10, filter: classIn("village", "suburb", "hamlet", "neighbourhood"),
        layout: {
          "text-font": ["Noto Sans Regular"],
          "text-field": ["get", "name"],
          "text-size": road(10, 10.5, 16, 14),
          "text-letter-spacing": 0.06,
          "text-transform": "uppercase",
        },
        paint: { "text-color": c.inkSoft, "text-halo-color": c.halo, "text-halo-width": 1.4 } },

      { id: "place-major", type: "symbol", source: src, "source-layer": "place",
        filter: classIn("city", "town"),
        layout: {
          "text-font": ["Noto Sans Bold"],
          "text-field": ["get", "name"],
          "text-size": road(5, 11, 14, 18),
          "text-letter-spacing": 0.04,
        },
        paint: { "text-color": c.ink, "text-halo-color": c.halo, "text-halo-width": 1.6 } },
    ],
  };
}
