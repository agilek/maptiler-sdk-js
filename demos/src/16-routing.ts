import { Map, MapStyle, config, routing, type RoutingUnits } from "../../src/index";
import { setupMapTilerApiKey } from "./demo-utils";

setupMapTilerApiKey({ config });

const map = new Map({
  container: document.getElementById("map")!,
  style: MapStyle.STREETS,
  center: [10.7, 48.8],
  zoom: 5.5,
  hash: true,
});

// Only two profiles are allowed here, so `setProfile("truck")` is refused with
// a warning — the restriction a routing UI would render its tabs from.
const controller = map.enableRouting({
  profiles: ["car", "bicycle"],
  alternates: 2,
  waypoints: [
    [8.5417, 47.3769], // Zurich
    [12.8724, 50.2329], // Karlovy Vary
  ],
});

const statusElement = document.getElementById("status")!;
const routesElement = document.getElementById("routes")!;
const stepsElement = document.getElementById("steps")!;
const profilesElement = document.getElementById("profiles")!;

//#region Profile buttons, built from what the session allows

for (const profile of controller.getAvailableProfiles()) {
  const button = document.createElement("button");
  button.textContent = profile;
  button.dataset.profile = profile;
  button.addEventListener("click", () => {
    controller.setProfile(profile);
    syncProfileButtons();
  });
  profilesElement.appendChild(button);
}

function syncProfileButtons() {
  for (const button of profilesElement.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.profile === controller.getProfile());
  }
}

syncProfileButtons();

//#endregion

//#region Waypoint actions

document.getElementById("add-stop")!.addEventListener("click", () => {
  // dropped in between the current endpoints, at the middle of the view
  const { lng, lat } = map.getCenter();
  controller.addWaypoint([lng, lat], Math.max(controller.getWaypoints().length - 1, 0));
});

document.getElementById("reverse")!.addEventListener("click", () => {
  const waypoints = controller.getWaypoints();
  controller.setWaypoints([...waypoints].reverse().map((waypoint) => ({ ...waypoint, id: undefined })));
});

document.getElementById("clear")!.addEventListener("click", () => {
  controller.clearWaypoints();
});

// click-to-add: the headless core leaves map clicks to the application, which
// is what makes it composable — the control layers its own behavior on top
map.on("click", (event) => {
  // a click that hit the route line is a selection, not a new waypoint
  if (map.queryRenderedFeatures(event.point, { layers: ["maptiler-routing-route-hitbox"] }).length > 0) return;
  controller.addWaypoint([event.lngLat.lng, event.lngLat.lat]);
});

//#endregion

//#region Units and style

for (const button of document.querySelectorAll<HTMLButtonElement>("button.units")) {
  button.addEventListener("click", () => {
    controller.setUnits(button.dataset.units as RoutingUnits);
    for (const other of document.querySelectorAll("button.units")) other.classList.toggle("active", other === button);
    renderRoutes();
  });
}
document.querySelector<HTMLButtonElement>('button.units[data-units="km"]')!.classList.add("active");

for (const button of document.querySelectorAll<HTMLButtonElement>("button.style")) {
  button.addEventListener("click", () => {
    map.setStyle(button.dataset.style!);
  });
}

//#endregion

//#region Rendering the results

function renderRoutes() {
  const routes = controller.getRoutes();
  const units = controller.getUnits();
  routesElement.replaceChildren();

  routes.forEach((route, index) => {
    const element = document.createElement("div");
    element.className = index === controller.getSelectedIndex() ? "route selected" : "route";

    const duration = document.createElement("strong");
    duration.textContent = routing.formatRouteDuration(route.summary.totalTime);

    const meta = document.createElement("div");
    meta.textContent = `${routing.formatRouteDistance(route.summary.totalLength, units)} · arrives ${routing.formatRouteArrival(route.summary.totalTime)}`;

    const description = document.createElement("div");
    description.className = "hint";
    description.textContent = routing.describeRouteUsage(route.summary);

    element.append(duration, meta, description);
    element.addEventListener("click", () => {
      controller.selectRoute(index);
    });
    routesElement.appendChild(element);
  });
}

function renderSteps() {
  const units = controller.getUnits();
  stepsElement.replaceChildren();

  for (const entry of controller.getSteps()) {
    const element = document.createElement("div");
    element.textContent = `${entry.step.maneuver?.instruction ?? entry.step.streetName ?? "Continue"} — ${routing.formatRouteDistance(entry.step.length, units)}`;
    element.addEventListener("click", () => {
      controller.zoomToStep(entry);
    });
    stepsElement.appendChild(element);
  }
}

//#endregion

//#region Events

controller.on("routingstart", () => {
  statusElement.className = "";
  statusElement.textContent = "Calculating…";
});

controller.on("routingroutes", (event) => {
  statusElement.className = "";
  statusElement.textContent = `${event.routes.length.toString()} route(s). Attribution: ${controller.getAttribution() ?? "—"}`;
  renderRoutes();
  renderSteps();
});

controller.on("routingselect", () => {
  renderRoutes();
  renderSteps();
});

controller.on("routingerror", (event) => {
  statusElement.className = "error";
  statusElement.textContent = event.error.message;
});

controller.on("routingclear", () => {
  statusElement.className = "";
  statusElement.textContent = "Waiting for waypoints…";
  renderRoutes();
  renderSteps();
});

controller.on("routingwaypoints", (event) => {
  if (event.waypoints.filter((waypoint) => waypoint.lngLat).length < 2) {
    statusElement.textContent = "Add at least two waypoints.";
  }
});

//#endregion
