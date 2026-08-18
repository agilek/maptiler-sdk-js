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

/**
 * Where this page reports what it did.
 *
 * The console rather than a pane in the sidebar: an on-screen list of event
 * names taught nothing the README does not, and the sidebar's room is better
 * spent on the snippet at the top of it.
 */
function log(message: string) {
  console.info(`[routing demo] ${message}`);
}

//#region Rebuilding the control with new options

/** Options currently applied, rebuilt into a fresh control on every change. */
let options: MaptilerRoutingControlOptions = {
  waypoints: [ZURICH, KARLOVY_VARY],
  alternates: 2,
};

/** Map corner the control is added to — not a control option, but `addControl`'s own argument. */
let position: "top-left" | "top-right" | "bottom-left" | "bottom-right" = "top-right";

let control = new MaptilerRoutingControl(options);
map.addControl(control, position);
wireEvents(control);

/**
 * Options the routing *session* is built with rather than the panel.
 *
 * A panel added to a map that already has a session joins it — that is the point
 * of the split, and it is why a route set programmatically shows up in the
 * panel. It also means these cannot be changed by building a new panel: the new
 * one adopts the session as it stands. `apply` recreates the session for them.
 */
const SESSION_OPTIONS = ["waypoints", "alternates", "units", "language", "dragWaypointsOnMap"] as const;

/**
 * Applies an option patch by replacing the control.
 *
 * The routing session survives — it belongs to the map, so the waypoints and the
 * computed routes are still there when the new panel renders — unless the patch
 * touches something only the session holds, in which case it is rebuilt too,
 * with the waypoints carried across.
 */
function apply(patch: Partial<MaptilerRoutingControlOptions>) {
  // a rebuilt control starts from its options, so without this every change
  // would shut the panel and hide the very thing being demonstrated
  const wasOpen = control.isOpen();
  const rebuildSession = SESSION_OPTIONS.some((key) => key in patch);

  // read before the session goes: whatever the visitor has put in the fields is
  // what the new session starts from, positions and names alike
  const carried = rebuildSession
    ? map
        .getRouting()
        ?.getWaypoints()
        .map((waypoint) => (waypoint.lngLat ? { lngLat: waypoint.lngLat, label: waypoint.label } : {}))
    : undefined;

  options = { ...options, ...patch };
  map.removeControl(control);
  if (rebuildSession) map.disableRouting();

  control = new MaptilerRoutingControl({ ...options, waypoints: carried ?? options.waypoints, open: patch.open ?? wasOpen });
  map.addControl(control, position);
  wireEvents(control);
  renderCode();
  syncSelection();
  log(`options: ${Object.keys(patch).join(", ")}`);
}

/** Style the map is on, which is the one piece of state not held in `options`. */
let styleId = "streets-v2";

/**
 * Marks the button in each group that matches what is currently applied.
 *
 * These groups are radio buttons in all but markup — one value each, and the
 * one in force is worth seeing. `aria-pressed` carries it, so the styling and
 * the accessible state are the same fact rather than two.
 *
 * Buttons that do something rather than select something — the programmatic
 * actions, "Unstyled" — are left alone: they have no state to be in.
 */
function syncSelection() {
  const current: Record<string, string> = {
    display: options.modeDisplay ?? "both",
    filters: options.filters === undefined ? "all" : options.filters.length === 0 ? "none" : "departure",
    units: options.units ?? "auto",
    theme: options.theme ?? "auto",
    format: options.formatters?.duration ? "compact" : "default",
    render: options.renderers?.routeCard ? "card" : "default",
    search: typeof options.search === "object" && options.search.provider ? "provider" : "maptiler",
    style: styleId,
    position,
  };

  for (const [group, value] of Object.entries(current)) {
    document.querySelectorAll<HTMLButtonElement>(`#panel [data-${group}]`).forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset[group] === value));
    });
  }
}

//#endregion

//#region The code behind the panel

const codeElement = document.getElementById("code")!;

/** Whether a key can be written as `key:` rather than `"key":`. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Whether a value is short enough, and simple enough, to stay on one line.
 *
 * `{ id: "car" }` and a coordinate pair read worse spread over three lines than
 * they do inline; a renderer's body has to break, however short it prints.
 */
function fits(source: string): boolean {
  return source.length <= 58 && !source.includes("\n");
}

/**
 * Prints a value as the source that would produce it.
 *
 * `JSON.stringify` cannot do this job: the options carry functions — the
 * formatter and renderer overrides — and quoting every key makes the result read
 * like data rather than like code someone would write. Functions are printed
 * from their own source, so what the snippet shows is what this page is running.
 *
 * @param value - The value to print.
 * @param depth - Nesting level, which sets the indentation.
 */
function toSource(value: unknown, depth = 1): string {
  const pad = "  ".repeat(depth);
  const padEnd = "  ".repeat(depth - 1);

  if (typeof value === "function") {
    // The source carries the indentation of the file it was written in, which is
    // rarely the one it lands at here. Every line after the first is shifted by
    // the same amount, so the body keeps its own shape and the closing brace
    // comes back to the level of the key the function is the value of.
    const [signature, ...rest] = value.toString().split("\n");
    if (rest.length === 0) return signature;

    const written = rest.filter((line) => line.trim() !== "");
    const base = Math.min(...written.map((line) => line.length - line.trimStart().length));

    return [signature, ...rest.map((line) => (line.trim() === "" ? "" : `${padEnd}${line.slice(base)}`))].join("\n");
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";

    const parts = value.map((entry) => toSource(entry, depth + 1));
    const inline = `[${parts.join(", ")}]`;
    if (fits(inline)) return inline;
    return `[\n${parts.map((part) => `${pad}${part}`).join(",\n")},\n${padEnd}]`;
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    if (entries.length === 0) return "{}";

    const parts = entries.map(([key, entry]) => `${IDENTIFIER.test(key) ? key : JSON.stringify(key)}: ${toSource(entry, depth + 1)}`);
    const inline = `{ ${parts.join(", ")} }`;
    if (fits(inline)) return inline;
    return `{\n${parts.map((part) => `${pad}${part}`).join(",\n")},\n${padEnd}}`;
  }

  return JSON.stringify(value) ?? String(value);
}

/** Rewrites the snippet to match the control currently on the map. */
function renderCode() {
  const body = toSource(options);
  const argument = body === "{}" ? "" : body;

  codeElement.textContent = [
    `import { MaptilerRoutingControl } from "@maptiler/sdk";`,
    "",
    `const control = new MaptilerRoutingControl(${argument});`,
    `map.addControl(control, ${JSON.stringify(position)});`,
  ].join("\n");
}

const copyButton = document.getElementById("copy-code") as HTMLButtonElement;

copyButton.addEventListener("click", () => {
  /**
   * The button is the whole message: a tick for a copy that worked, a red
   * outline and a title for one the browser refused. Both fall back to the
   * sheets icon, so it always ends up inviting the next copy.
   */
  const say = (state: "copied" | "failed", label: string) => {
    copyButton.dataset.state = state;
    copyButton.title = label;
    copyButton.setAttribute("aria-label", label);

    setTimeout(() => {
      delete copyButton.dataset.state;
      copyButton.title = "Copy the code";
      copyButton.setAttribute("aria-label", "Copy the code");
    }, 1500);
  };

  navigator.clipboard.writeText(codeElement.textContent ?? "").then(
    () => {
      say("copied", "Copied");
    },
    () => {
      // a page served over plain http, or a browser that refuses: selecting the
      // block by hand still works, so say so rather than failing silently
      say("failed", "Could not copy — select the code and copy it");
    },
  );
});

renderCode();
syncSelection();

//#endregion

//#region Listening to the panel

/**
 * Subscribes to everything the panel fires, and reports it to the console.
 *
 * Kept for the sake of the code rather than the output: this is what listening
 * to the control looks like.
 */
function wireEvents(instance: MaptilerRoutingControl) {
  for (const type of ["routinguiopen", "routinguiclose", "routinguiviewchange", "routinguistepclick", "routinguipickstart", "routinguipickend"]) {
    instance.on(type, () => {
      log(type);
    });
  }
}

//#endregion

//#region Option showcase

const customLabelsToggle = document.getElementById("opt-custom-labels") as HTMLInputElement;
const modeLabelFields = document.getElementById("mode-labels")!;

/**
 * Rebuilds `modes` from the ticked checkboxes, in the order they appear.
 *
 * `modes` takes either a profile name or a `{ id, label }` object, and this is
 * where the demo chooses between the two: with custom labels off it passes the
 * bare names and every tab keeps its built-in one, and with them on it passes
 * objects carrying whatever has been typed. A field left empty falls back to the
 * built-in name, which is what omitting `label` means.
 */
function applyCheckedModes() {
  const checked = [...document.querySelectorAll<HTMLInputElement>("#panel .mode-toggle:checked")].map((input) => input.value as RoutingProfile);

  if (!customLabelsToggle.checked) {
    // an empty list hides the switcher entirely — names and all
    apply({ modes: checked });
    return;
  }

  apply({
    modes: checked.map((id) => {
      const label = document.querySelector<HTMLInputElement>(`#panel .mode-label[data-mode="${id}"]`)?.value.trim();
      return label ? { id, label } : { id };
    }),
  });
}

document.querySelectorAll<HTMLInputElement>("#panel .mode-toggle").forEach((input) => {
  input.addEventListener("change", applyCheckedModes);
});

customLabelsToggle.addEventListener("change", () => {
  modeLabelFields.hidden = !customLabelsToggle.checked;
  applyCheckedModes();
});

document.querySelectorAll<HTMLInputElement>("#panel .mode-label").forEach((input) => {
  // "change" rather than "input": each one rebuilds the control, so the rename
  // lands when the field is left rather than on every keystroke
  input.addEventListener("change", applyCheckedModes);
});

document.querySelectorAll<HTMLButtonElement>("#panel [data-display]").forEach((button) => {
  button.addEventListener("click", () => {
    apply({ modeDisplay: button.dataset.display as RoutingModeDisplay });
  });
});

document.getElementById("opt-hide-single-mode")!.addEventListener("change", (event) => {
  // the option says when to show it, the box asks when to hide it
  apply({ showSingleMode: !(event.target as HTMLInputElement).checked });
});

document.querySelectorAll<HTMLButtonElement>("#panel [data-filters]").forEach((button) => {
  button.addEventListener("click", () => {
    const value = button.dataset.filters;
    if (value === "all") apply({ filters: undefined });
    else if (value === "departure") apply({ filters: ["departure"] });
    else apply({ filters: [] });
  });
});

document.querySelectorAll<HTMLButtonElement>("#panel [data-units]").forEach((button) => {
  button.addEventListener("click", () => {
    // km and mi fix the unit; "shown" is the only value that gives the end user
    // the toggle, and "auto" reads it from the browser
    apply({ units: button.dataset.units as MaptilerRoutingControlOptions["units"] });
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

document.querySelectorAll<HTMLButtonElement>("#panel [data-theme]").forEach((button) => {
  button.addEventListener("click", () => {
    // the panel ships two palettes and nothing to configure inside them;
    // "auto" is the default, and follows the browser's own setting
    apply({ theme: button.dataset.theme as MaptilerRoutingControlOptions["theme"] });
  });
});

//#endregion

//#region Formatting

// Every string the panel shows can be replaced through `labels`, one key at a
// time — that is how a non-English page localizes it, since the SDK ships the
// strings in English only. Values (durations, distances, arrival clocks) need no
// override: they follow `config.primaryLanguage` through Intl.
document.querySelectorAll<HTMLButtonElement>("#panel [data-format]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.format === "default") {
      apply({ formatters: {} });
      return;
    }

    // formatters are independent of labels: minutes all the way up
    apply({ formatters: { duration: (seconds) => `${Math.round(seconds / 60).toString()} min` } });
  });
});

//#endregion

//#region Escape hatches

document.querySelectorAll<HTMLButtonElement>("#panel [data-render]").forEach((button) => {
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

document.querySelector<HTMLButtonElement>("#panel [data-unstyled]")!.addEventListener("click", () => {
  apply({ unstyled: true });
});

/** Stands in for a consumer's own address database. */
const OWN_PLACES = [
  { name: "Head office", label: "Bahnhofquai 15, 8001 Zurich", lngLat: [8.5417, 47.3769] as [number, number] },
  { name: "Spa branch", label: "Vítězná 1058/5, 360 01 Karlovy Vary", lngLat: [12.8724, 50.2329] as [number, number] },
  { name: "Warehouse", label: "Landsberger Allee 366, 80339 Munich", lngLat: [11.582, 48.1351] as [number, number] },
];

document.querySelectorAll<HTMLButtonElement>("#panel [data-search]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.search === "maptiler") {
      // no provider is the default: the fields go back to MapTiler Geocoding
      apply({ search: true });
      return;
    }

    apply({
      search: {
        minLength: 1,
        // the panel keeps the field, the list and the keyboard handling; only
        // where the places come from changes
        provider: (query) => OWN_PLACES.filter((place) => `${place.name} ${place.label}`.toLowerCase().includes(query.toLowerCase())),
        // and the other half: naming a point picked off the map
        reverse: ([lng, lat]) => {
          const near = OWN_PLACES.find((place) => Math.abs(place.lngLat[0] - lng) < 0.5 && Math.abs(place.lngLat[1] - lat) < 0.5);
          return near ? `Near ${near.name}` : undefined;
        },
      },
    });
  });
});

//#endregion

document.querySelectorAll<HTMLButtonElement>("#panel [data-position]").forEach((button) => {
  button.addEventListener("click", () => {
    // not a control option: the corner is `addControl`'s own argument, so a
    // change here rebuilds and re-adds the control rather than patching options
    position = button.dataset.position as typeof position;
    apply({});
  });
});

document.querySelectorAll<HTMLButtonElement>("#panel [data-style]").forEach((button) => {
  button.addEventListener("click", () => {
    styleId = button.dataset.style!;
    map.setStyle(styleId);
    syncSelection();
  });
});

//#endregion
