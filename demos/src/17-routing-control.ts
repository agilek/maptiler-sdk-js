import { Map, MapStyle, MaptilerRoutingControl, config, type MaptilerRoutingControlOptions, type RoutingModeDisplay, type RoutingProfile } from "../../src/index";
import { setupMapTilerApiKey } from "./demo-utils";

setupMapTilerApiKey({ config });

const map = new Map({
  container: document.getElementById("map")!,
  style: MapStyle.STREETS,
  center: [10.7, 48.8],
  zoom: 5.5,
});

const ZURICH: [number, number] = [8.5417, 47.3769];
const KARLOVY_VARY: [number, number] = [12.8724, 50.2329];
const MUNICH: [number, number] = [11.582, 48.1351];

const logElement = document.getElementById("log")!;

function log(message: string) {
  logElement.textContent = `${message}\n${logElement.textContent ?? ""}`.split("\n").slice(0, 40).join("\n");
}

//#region Rebuilding the control with new options

/** Options currently applied, rebuilt into a fresh control on every change. */
let options: MaptilerRoutingControlOptions = {
  waypoints: [ZURICH, KARLOVY_VARY],
  alternates: 2,
};

let control = new MaptilerRoutingControl(options);
map.addControl(control, "top-right");
wireEvents(control);

/**
 * Applies an option patch by replacing the control.
 *
 * The routing session survives: it belongs to the map, so the waypoints and
 * the computed routes are still there when the new panel renders.
 */
function apply(patch: Partial<MaptilerRoutingControlOptions>) {
  options = { ...options, ...patch };
  map.removeControl(control);
  control = new MaptilerRoutingControl(options);
  map.addControl(control, "top-right");
  wireEvents(control);
  log(`options: ${Object.keys(patch).join(", ")}`);
}

function wireEvents(instance: MaptilerRoutingControl) {
  for (const type of ["routinguiopen", "routinguiclose", "routinguiviewchange", "routinguistepclick", "routinguipickstart", "routinguipickend"]) {
    instance.on(type, () => {
      log(type);
    });
  }
}

//#endregion

//#region Option showcase

/** Rebuilds `modes` from the ticked checkboxes, in the order they appear. */
function applyCheckedModes() {
  const checked = [...document.querySelectorAll<HTMLInputElement>(".mode-toggle:checked")].map((input) => input.value as RoutingProfile);
  // an empty list hides the switcher entirely — names and all
  apply({ modes: checked });
}

document.querySelectorAll<HTMLInputElement>(".mode-toggle").forEach((input) => {
  input.addEventListener("change", applyCheckedModes);
});

document.querySelectorAll<HTMLButtonElement>("[data-display]").forEach((button) => {
  button.addEventListener("click", () => {
    apply({ modeDisplay: button.dataset.display as RoutingModeDisplay });
  });
});

document.getElementById("opt-single-mode")!.addEventListener("change", (event) => {
  apply({ showSingleMode: (event.target as HTMLInputElement).checked });
});

document.querySelectorAll<HTMLButtonElement>("[data-modes]").forEach((button) => {
  button.addEventListener("click", () => {
    apply({ modes: [{ id: "car", label: "Drive" }] });
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-filters]").forEach((button) => {
  button.addEventListener("click", () => {
    const value = button.dataset.filters;
    if (value === "all") apply({ filters: undefined });
    else if (value === "units") apply({ filters: ["units"] });
    else apply({ filters: [] });
  });
});

document.getElementById("opt-search")!.addEventListener("change", (event) => {
  apply({ search: (event.target as HTMLInputElement).checked });
});
document.getElementById("opt-drag")!.addEventListener("change", (event) => {
  apply({ dragWaypointsOnMap: (event.target as HTMLInputElement).checked });
});
document.getElementById("opt-turn")!.addEventListener("change", (event) => {
  apply({ turnByTurn: (event.target as HTMLInputElement).checked });
});
document.getElementById("opt-launcher")!.addEventListener("change", (event) => {
  apply({ launcher: (event.target as HTMLInputElement).checked });
});

//#endregion

//#region Theming

document.getElementById("accent")!.addEventListener("input", (event) => {
  apply({ theme: { ...options.theme, accent: (event.target as HTMLInputElement).value } });
});

document.querySelectorAll<HTMLButtonElement>("[data-theme]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.theme === "reset") {
      apply({ theme: {}, unstyled: false });
      return;
    }

    // the copy-pasteable dark token set from the README
    apply({
      theme: {
        surface: "#12161f",
        surfaceAlt: "#1b2230",
        surfaceHover: "#232c3d",
        textColor: "#e6eaf2",
        mutedColor: "#95a0b5",
        borderColor: "#2b3446",
        accent: "#6f9bff",
        accentContrast: "#0b0e14",
      },
    });
  });
});

//#endregion

//#region Localization and formatting

const TRANSLATIONS: Record<string, MaptilerRoutingControlOptions["labels"]> = {
  en: undefined,
  fr: {
    title: "Itinéraire",
    from: "Point de départ",
    to: "Destination",
    stop: "Étape",
    addStop: "Ajouter une étape",
    routes: "Itinéraires",
    loading: "Calcul de l'itinéraire…",
    needsWaypoints: "Choisissez un départ et une destination.",
    modes: { car: "Voiture", truck: "Camion", bicycle: "Vélo", pedestrian: "À pied" },
    avoid: "Éviter",
    avoidances: { tolls: "Péages", highway: "Autoroutes", ferry: "Ferries" },
  },
  de: {
    title: "Route",
    from: "Startpunkt",
    to: "Ziel",
    stop: "Zwischenstopp",
    addStop: "Zwischenstopp hinzufügen",
    routes: "Routen",
    loading: "Route wird berechnet…",
    needsWaypoints: "Start und Ziel wählen.",
    modes: { car: "Auto", truck: "LKW", bicycle: "Rad", pedestrian: "Zu Fuß" },
    avoid: "Vermeiden",
    avoidances: { tolls: "Maut", highway: "Autobahnen", ferry: "Fähren" },
  },
};

document.querySelectorAll<HTMLButtonElement>("[data-lang]").forEach((button) => {
  button.addEventListener("click", () => {
    const value = button.dataset.lang!;

    if (value === "compact") {
      // formatters are independent of labels: minutes all the way up
      apply({ formatters: { duration: (seconds) => `${Math.round(seconds / 60).toString()} min` } });
      return;
    }

    apply({ labels: TRANSLATIONS[value], formatters: {} });
  });
});

//#endregion

//#region Escape hatches

document.querySelectorAll<HTMLButtonElement>("[data-render]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.render === "default") {
      apply({ renderers: {} });
      return;
    }

    apply({
      renderers: {
        // a completely different card that still drives the same session
        routeCard: ({ route, index, selected, control: instance, formatters }) => {
          const element = document.createElement("li");
          element.style.cssText = `padding:10px;margin-bottom:6px;border-radius:8px;cursor:pointer;color:#fff;background:${selected ? "#0b7285" : "#495057"}`;
          element.textContent = `#${(index + 1).toString()} · ${formatters.duration(route.summary.totalTime)}`;
          element.addEventListener("click", () => instance.getRouting()?.selectRoute(index));
          return element;
        },
      },
    });
  });
});

document.querySelector<HTMLButtonElement>("[data-unstyled]")!.addEventListener("click", () => {
  apply({ unstyled: true });
});

//#endregion

//#region Programmatic API

document.querySelectorAll<HTMLButtonElement>("[data-api]").forEach((button) => {
  button.addEventListener("click", () => {
    const routing = control.getRouting();
    const value = button.dataset.api;

    if (value === "waypoints") routing?.setWaypoints([ZURICH, MUNICH, KARLOVY_VARY]);
    else if (value === "select") routing?.selectRoute(1);
    else if (value === "detail") control.showRouteDetail();
    else if (value === "collapse") control.toggle();
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-style]").forEach((button) => {
  button.addEventListener("click", () => {
    map.setStyle(button.dataset.style!);
  });
});

//#endregion
