import type { GeocodingFeature } from "@maptiler/client";
import type { RoutingWaypoint } from "../types";
import type { RoutingPanelContext } from "./routing-ui-context";
import { RC } from "./routing-ui-defaults";
import { button, el, icon, setBooleanAttribute, setDataFlag } from "./routing-ui-dom";

/** DOM and state of one waypoint row. */
type WaypointRow = {
  element: HTMLLIElement;
  input: HTMLInputElement;
  list: HTMLUListElement;
  /** Index of the highlighted suggestion, or `-1` when none is. */
  activeSuggestion: number;
  suggestions: GeocodingFeature[];
};

/** Unique-enough id source for the `aria-controls` / `aria-activedescendant` wiring. */
let listboxSequence = 0;

/**
 * The waypoint list: one row per waypoint, each a geocoding combobox, plus the
 * "add a stop" and "add from map" actions.
 *
 * Rows are reused by waypoint id across renders, so typing, the caret position
 * and an open suggestion list all survive a re-render triggered by something
 * else on the panel.
 */
export class WaypointsView {
  /** Root element of the view. */
  readonly element: HTMLElement;

  private readonly context: RoutingPanelContext;
  private readonly list: HTMLUListElement;
  private readonly addStopButton: HTMLButtonElement;
  private readonly pickButton?: HTMLButtonElement;
  private readonly rows = new Map<string, WaypointRow>();

  /** Set while a row is being dragged, so the drop target can be resolved. */
  private dragIndex: number | null = null;

  constructor(context: RoutingPanelContext) {
    this.context = context;
    const { labels, clickToAddWaypoint } = context.options;

    this.element = el("div");
    this.list = el("ul", RC.waypoints);
    this.list.setAttribute("role", "list");

    const actions = el("div", RC.actions);
    this.addStopButton = button(RC.addStop, labels.addStop);
    this.addStopButton.prepend(icon("plus"));
    this.addStopButton.addEventListener("click", () => {
      this.addStop();
    });
    actions.append(this.addStopButton);

    // "off" means the application owns map clicks entirely, so the affordance
    // that arms them would be misleading
    if (clickToAddWaypoint !== "off") {
      this.pickButton = button(RC.pickOnMap, labels.pickOnMap, "my-location");
      this.pickButton.addEventListener("click", () => {
        context.control.togglePickOnMap();
      });
      actions.append(this.pickButton);
    }

    this.element.append(this.list, actions);
  }

  //#region Rendering

  /** Renders the rows for the current waypoints. */
  render(): void {
    const waypoints = this.context.routing.getWaypoints();
    const { maxWaypoints, renderers, labels, formatters } = this.context.options;

    const custom = renderers.waypointRow;
    const fragment = document.createDocumentFragment();
    const seen = new Set<string>();

    waypoints.forEach((waypoint, index) => {
      seen.add(waypoint.id);
      const role = index === 0 ? "origin" : index === waypoints.length - 1 ? "destination" : "stop";

      const replacement = custom?.({ waypoint, index, count: waypoints.length, role, control: this.context.control, labels, formatters });
      if (replacement) {
        fragment.append(replacement);
        return;
      }

      fragment.append(this.renderRow(waypoint, index, waypoints.length, role));
    });

    for (const [id, row] of this.rows) {
      if (seen.has(id)) continue;
      row.element.remove();
      this.rows.delete(id);
    }

    this.list.replaceChildren(fragment);
    this.addStopButton.disabled = waypoints.length >= maxWaypoints;
    setBooleanAttribute(this.addStopButton, "aria-disabled", waypoints.length >= maxWaypoints);
  }

  /** Shows the in-field clear button only when there is something to clear. */
  private syncClearButton(row: WaypointRow): void {
    const clear = row.element.querySelector<HTMLButtonElement>(`.${RC.waypointClear}`);
    if (!clear) return;
    clear.hidden = row.input.value.trim() === "";
  }

  /** Reflects the armed state of the "add from map" toggle. */
  setPicking(picking: boolean): void {
    if (!this.pickButton) return;
    setBooleanAttribute(this.pickButton, "aria-pressed", picking);
  }

  /** Builds, or updates, the row for one waypoint. */
  private renderRow(waypoint: RoutingWaypoint, index: number, count: number, role: "origin" | "stop" | "destination"): HTMLLIElement {
    const { labels, reorderWaypoints, search } = this.context.options;
    const existing = this.rows.get(waypoint.id);
    const row = existing ?? this.createRow(waypoint);

    row.element.dataset.role = role;
    row.element.dataset.index = index.toString();
    setDataFlag(row.element, "located", waypoint.lngLat !== null);

    const placeholder = role === "origin" ? labels.from : role === "destination" ? labels.to : labels.stop;
    row.input.placeholder = placeholder;
    row.input.setAttribute("aria-label", placeholder);
    row.input.readOnly = !search.enabled;
    row.input.draggable = false;

    // never write over what the user is typing
    if (document.activeElement !== row.input) {
      row.input.value = waypoint.label ?? (waypoint.lngLat ? formatCoordinate(waypoint.lngLat) : "");
    }

    this.syncClearButton(row);

    const pin = row.element.querySelector<HTMLElement>(`.${RC.waypointPin}`);
    if (pin) pin.dataset.icon = role === "origin" ? "route-start" : role === "destination" ? "route-pin" : "route-stop";

    const handle = row.element.querySelector<HTMLElement>(`.${RC.waypointHandle}`);
    if (handle) handle.hidden = !reorderWaypoints;

    const remove = row.element.querySelector<HTMLButtonElement>(`.${RC.waypointRemove}`);
    if (remove) {
      // the first and last rows are the route's endpoints: they are emptied
      // rather than removed, so the form always has a From and a To
      const isEndpoint = index === 0 || index === count - 1;
      remove.disabled = isEndpoint && waypoint.lngLat === null;
    }

    return row.element;
  }

  /** Creates the DOM of a row, wiring every listener once. */
  private createRow(waypoint: RoutingWaypoint): WaypointRow {
    const { labels } = this.context.options;
    const listId = `maptiler-routing-suggestions-${(++listboxSequence).toString()}`;

    const element = el("li", RC.waypoint);

    const handle = button(RC.waypointHandle, labels.reorderStop, "drag");
    handle.draggable = true;

    const field = el("div", RC.waypointField);
    const pin = icon("route-stop");
    pin.classList.add(RC.waypointPin);

    const input = el("input", RC.waypointInput);
    input.type = "text";
    input.autocomplete = "off";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", listId);

    const list = el("ul", RC.suggestions);
    list.id = listId;
    list.setAttribute("role", "listbox");
    list.hidden = true;

    // the design puts a clear button inside the field, distinct from the
    // delete button outside it: one empties the field, the other removes the
    // stop altogether
    const clear = button(RC.waypointClear, labels.clearWaypoint, "clear");
    clear.hidden = true;

    const remove = button(RC.waypointRemove, labels.removeStop, "trash");

    field.append(pin, input, clear, list);
    element.append(handle, field, remove);

    const row: WaypointRow = { element, input, list, activeSuggestion: -1, suggestions: [] };
    this.rows.set(waypoint.id, row);

    this.wireRow(row, waypoint.id);

    return row;
  }

  //#endregion

  //#region Interaction

  private wireRow(row: WaypointRow, id: string): void {
    const { search, formatters } = this.context.options;

    row.element.querySelector(`.${RC.waypointClear}`)?.addEventListener("click", () => {
      // clears the field without removing the row: the stop stays, waiting for
      // a new value
      row.input.value = "";
      this.syncClearButton(row);
      this.closeSuggestions(row);
      this.context.routing.updateWaypoint(id, { lngLat: null, label: undefined });
      row.input.focus();
    });

    row.input.addEventListener("input", () => {
      this.syncClearButton(row);
      if (!search.enabled) return;
      const { lng, lat } = this.context.map.getCenter();
      this.context.geocoder.search(row.input.value, [lng, lat], (features) => {
        row.suggestions = features;
        row.activeSuggestion = -1;
        this.renderSuggestions(row, id);
      });
    });

    row.input.addEventListener("keydown", (event) => {
      this.handleKeydown(event, row, id);
    });

    row.input.addEventListener("focus", () => {
      // an empty field offers the two ways of filling it that are not typing,
      // as the design's search results do
      if (row.input.value.trim() === "") this.renderActionRows(row, id);
    });

    row.input.addEventListener("blur", () => {
      // let a pointerdown on a suggestion win the race with blur
      setTimeout(() => {
        this.closeSuggestions(row);
      }, 120);
    });

    row.element.querySelector(`.${RC.waypointRemove}`)?.addEventListener("click", () => {
      const waypoints = this.context.routing.getWaypoints();
      const index = waypoints.findIndex((waypoint) => waypoint.id === id);
      const isEndpoint = index === 0 || index === waypoints.length - 1;

      if (isEndpoint) this.context.routing.updateWaypoint(id, { lngLat: null, label: undefined });
      else this.context.routing.removeWaypoint(id);
    });

    const handle = row.element.querySelector<HTMLElement>(`.${RC.waypointHandle}`);
    handle?.addEventListener("dragstart", (event) => {
      this.dragIndex = this.indexOf(id);
      setDataFlag(row.element, "dragging", true);
      (event as DragEvent).dataTransfer?.setData("text/plain", id);
    });

    handle?.addEventListener("dragend", () => {
      this.dragIndex = null;
      setDataFlag(row.element, "dragging", false);
    });

    row.element.addEventListener("dragover", (event) => {
      if (this.dragIndex === null) return;
      event.preventDefault();
    });

    row.element.addEventListener("drop", (event) => {
      if (this.dragIndex === null) return;
      event.preventDefault();
      this.context.routing.moveWaypoint(this.dragIndex, this.indexOf(id));
      this.dragIndex = null;
    });

    // keyboard reordering, since a drag handle is unusable without a pointer
    handle?.addEventListener("keydown", (event) => {
      if (!event.altKey) return;
      const index = this.indexOf(id);
      if (event.key === "ArrowUp") {
        event.preventDefault();
        this.context.routing.moveWaypoint(index, Math.max(index - 1, 0));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        this.context.routing.moveWaypoint(index, index + 1);
      }
    });

    void formatters;
  }

  private handleKeydown(event: KeyboardEvent, row: WaypointRow, id: string): void {
    if (row.list.hidden || row.suggestions.length === 0) {
      if (event.key === "ArrowDown" && row.suggestions.length > 0) this.openSuggestions(row);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      row.activeSuggestion = (row.activeSuggestion + 1) % row.suggestions.length;
      this.renderSuggestions(row, id);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      row.activeSuggestion = row.activeSuggestion <= 0 ? row.suggestions.length - 1 : row.activeSuggestion - 1;
      this.renderSuggestions(row, id);
    } else if (event.key === "Enter") {
      const feature = row.suggestions.at(row.activeSuggestion === -1 ? 0 : row.activeSuggestion);
      if (feature) {
        event.preventDefault();
        this.pick(feature, row, id);
      }
    } else if (event.key === "Escape") {
      this.closeSuggestions(row);
    }
  }

  /**
   * The two non-typing ways to fill a field: the visitor's own position, and
   * a point picked off the map.
   */
  private renderActionRows(row: WaypointRow, id: string): void {
    const { labels } = this.context.options;
    const fragment = document.createDocumentFragment();

    const actions: { icon: string; label: string; run: () => void }[] = [
      {
        icon: "my-location",
        label: labels.myLocation,
        run: () => {
          this.useMyLocation(row, id);
        },
      },
      {
        icon: "plus",
        label: labels.selectFromMap,
        run: () => {
          this.context.control.togglePickOnMap(id);
        },
      },
    ];

    for (const action of actions) {
      const option = el("li", RC.suggestion);
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.dataset.action = action.icon;

      const lines = el("span", RC.suggestionLines);
      lines.append(el("span", RC.suggestionPrimary, action.label));
      option.append(icon(action.icon), lines, icon("chevron-right"));

      // pointerdown, so the input's blur does not tear the list down first
      option.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        this.closeSuggestions(row);
        action.run();
      });

      fragment.append(option);
    }

    row.list.replaceChildren(fragment);
    this.openSuggestions(row);
  }

  /** Fills a waypoint from the browser's geolocation. */
  private useMyLocation(row: WaypointRow, id: string): void {
    const { labels } = this.context.options;

    // typed as always present, but absent in insecure contexts
    if (!(navigator as { geolocation?: Geolocation }).geolocation) {
      console.warn("[MaptilerRoutingControl]: This browser exposes no geolocation, so 'My location' cannot be used.");
      return;
    }

    row.input.value = labels.locating;
    this.syncClearButton(row);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lngLat: [number, number] = [position.coords.longitude, position.coords.latitude];
        // the design shows the field reading "My location" rather than an
        // address, so the label is set rather than reverse-geocoded
        this.context.routing.updateWaypoint(id, { lngLat, label: labels.myLocation });
      },
      () => {
        // permission denied or unavailable: leave the field as the user found it
        row.input.value = "";
        this.syncClearButton(row);
        console.warn("[MaptilerRoutingControl]: The browser could not provide a location.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  }

  /** Id of the waypoint whose field currently has focus, if any. */
  getFocusedWaypointId(): string | undefined {
    for (const [id, row] of this.rows) {
      if (document.activeElement === row.input) return id;
    }
    return undefined;
  }

  private renderSuggestions(row: WaypointRow, id: string): void {
    const { formatters } = this.context.options;

    if (row.suggestions.length === 0) {
      this.closeSuggestions(row);
      return;
    }

    const fragment = document.createDocumentFragment();

    row.suggestions.forEach((feature, index) => {
      const option = el("li", RC.suggestion);
      option.id = `${row.list.id}-option-${index.toString()}`;
      option.setAttribute("role", "option");
      setBooleanAttribute(option, "aria-selected", index === row.activeSuggestion);
      setDataFlag(option, "active", index === row.activeSuggestion);

      const primary = (feature as { text?: string }).text ?? "";
      const lines = el("span", RC.suggestionLines);
      lines.append(el("span", RC.suggestionPrimary, primary), el("span", RC.suggestionSecondary, formatters.waypointLabel(feature)));
      option.append(icon("place-area"), lines, icon("chevron-right"));

      // pointerdown, not click: the input's blur would otherwise tear the list
      // down before a click could land on it
      option.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        this.pick(feature, row, id);
      });

      fragment.append(option);
    });

    row.list.replaceChildren(fragment);
    this.openSuggestions(row);

    const active = row.activeSuggestion === -1 ? "" : `${row.list.id}-option-${row.activeSuggestion.toString()}`;
    if (active) row.input.setAttribute("aria-activedescendant", active);
    else row.input.removeAttribute("aria-activedescendant");
  }

  private openSuggestions(row: WaypointRow): void {
    row.list.hidden = false;
    row.input.setAttribute("aria-expanded", "true");
  }

  /** Closes one row's suggestion list. */
  private closeSuggestions(row: WaypointRow): void {
    row.list.hidden = true;
    row.list.replaceChildren();
    row.activeSuggestion = -1;
    row.input.setAttribute("aria-expanded", "false");
    row.input.removeAttribute("aria-activedescendant");
  }

  /** Closes every open suggestion list, e.g. when the map is interacted with. */
  closeAllSuggestions(): void {
    for (const row of this.rows.values()) this.closeSuggestions(row);
  }

  private pick(feature: GeocodingFeature, row: WaypointRow, id: string): void {
    const { formatters } = this.context.options;
    const [lon, lat] = feature.center;

    row.input.value = formatters.waypointLabel(feature);
    this.closeSuggestions(row);
    this.context.routing.updateWaypoint(id, { lngLat: [lon, lat], label: formatters.waypointLabel(feature) });
  }

  private addStop(): void {
    const waypoints = this.context.routing.getWaypoints();
    // a new stop belongs before the destination, which is where a user adding
    // one to an existing route expects it
    this.context.routing.addWaypoint({}, Math.max(waypoints.length - 1, 0));
  }

  private indexOf(id: string): number {
    return this.context.routing.getWaypoints().findIndex((waypoint) => waypoint.id === id);
  }

  //#endregion
}

/** Fallback text for a waypoint that has a position but no name yet. */
function formatCoordinate([lon, lat]: [number, number]): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
