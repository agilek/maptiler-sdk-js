import "../../dist/maptiler-sdk.css";
import { Map as MapTiler, MapStyle } from "../../src/index";

const map = new MapTiler({
  container: "map",
  apiKey: "DOESNT_MATTER",
  style: MapStyle.STREETS,
  center: [10.7, 48.8],
  zoom: 5.5,
  routing: {
    alternates: 2,
    waypoints: [
      [8.5417, 47.3769],
      [12.8724, 50.2329],
    ],
    // deterministic camera: the test asserts on layers and data, not on a
    // moving map
    fitBounds: false,
  },
});

window.__map = map;

// Recorded so the test can assert on behavior rather than only on pixels.
window.__routingEvents = [];

void map.once("style.load", () => {
  const routing = map.getRouting();
  if (!routing) return;

  for (const type of ["routingstart", "routingroutes", "routingselect", "routingerror", "routingclear"] as const) {
    routing.on(type, (event) => {
      window.__routingEvents.push({ type, selectedIndex: "selectedIndex" in event ? event.selectedIndex : undefined });
    });
  }
});
