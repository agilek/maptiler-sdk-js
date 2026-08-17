import "../../dist/maptiler-sdk.css";
import type { ControlPosition } from "maplibre-gl";
import { Map as MapTiler, MapStyle, MaptilerRoutingControl } from "../../src/index";

const params = new URLSearchParams(window.location.search);
const position = (params.get("position") as ControlPosition | null) ?? "top-right";

const map = new MapTiler({
  container: "map",
  apiKey: "DOESNT_MATTER",
  style: MapStyle.STREETS,
  center: [10.7, 48.8],
  zoom: 5.5,
});

window.__map = map;

// Recorded so tests can assert on behavior rather than only on pixels — the
// panel's own events, distinct from window.__routingEvents (the headless
// fixture's session events), since a test may want either or both.
window.__panelEvents = [];

// `fitBounds` is a session option, not a panel one — created through
// `enableRouting` first, with the waypoints, so the panel below joins this
// session instead of starting its own. Same pattern the SDK itself expects:
// one session per map, shared between the headless API and any panel.
map.enableRouting({
  waypoints: [
    [8.5417, 47.3769], // Zurich
    [12.8724, 50.2329], // Karlovy Vary
  ],
  alternates: 2,
  // deterministic camera: tests assert on DOM and layers, not on a moving map
  fitBounds: false,
});

const control = new MaptilerRoutingControl({});

for (const type of ["routinguiopen", "routinguiclose", "routinguiviewchange", "routinguistepclick", "routinguipickstart", "routinguipickend"] as const) {
  control.on(type, () => {
    window.__panelEvents.push({ type });
  });
}

map.addControl(control, position);
window.__control = control;
