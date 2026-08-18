import type { RoutingWaypoint } from "../types";
import type { RoutingPanelContext } from "./routing-ui-context";
import type { RoutingPlace } from "./routing-geocoder";
import { placeFloating } from "./routing-floating";
import { RC } from "./routing-ui-defaults";
import { button, el, icon, setBooleanAttribute, setDataFlag } from "./routing-ui-dom";

/** DOM and state of one waypoint row. */
type WaypointRow = {
  element: HTMLLIElement;
  input: HTMLInputElement;
  list: HTMLUListElement;
  /** Index of the highlighted suggestion, or `-1` when none is. */
  activeSuggestion: number;
  suggestions: RoutingPlace[];
  /**
   * `true` while the visitor is part-way through typing something.
   *
   * A render must not overwrite a half-typed query, but it must overwrite
   * everything else — including the text the panel itself put there, like
   * "Locating…", which the field would otherwise keep showing long after the
   * position arrived, because the field is still focused.
   */
  editing: boolean;
};

/** Unique-enough id source for the `aria-controls` / `aria-activedescendant` wiring. */
let listboxSequence = 0;

/** How far the pointer travels before a press on a handle becomes a drag. */
const DRAG_THRESHOLD = 4;

/**
 * A reorder in progress.
 *
 * The drag is driven by pointer events rather than HTML5 drag and drop: a
 * native drag hands the cursor to the browser, which paints its own arrow and
 * ignores `cursor`, and its drag image is a one-off snapshot — so the carried
 * row could never show what the field holds, since `cloneNode` copies the
 * value attribute and not the text the panel writes as a property.
 */
type DragSession = {
  /** Waypoint being carried. */
  id: string;
  /** Index it was picked up from, which is what the drop is measured against. */
  index: number;
  row: WaypointRow;
  /** The handle holding the pointer capture, so it can be released on cancel. */
  handle: HTMLElement;
  pointerId: number;
  /** Where the press landed, for the threshold above. */
  startX: number;
  startY: number;
  /** Where in the row it was gripped, so the copy keeps that grip. */
  offsetX: number;
  offsetY: number;
  /** The copy under the pointer. `null` until the press passes the threshold. */
  ghost: HTMLElement | null;
  /** The page's own cursor, put back when the drag ends. */
  cursor: string | null;
  /** Escape cancels the drag; kept so the listener can be removed again. */
  onKeydown: (event: KeyboardEvent) => void;
};

/** A drop position: a row, and which of its edges the drop lands against. */
type DropTarget = { row: WaypointRow; id: string; after: boolean };

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
  private readonly rows = new Map<string, WaypointRow>();

  /** Set while a row is being dragged, so the drop target can be resolved. */
  private drag: DragSession | null = null;

  /**
   * Waypoint whose field takes the caret as soon as its row exists.
   *
   * The row is not there when the stop is added — the session announces the
   * change and the panel renders on the next frame — so the intent is parked
   * here and acted on by the render that builds the row.
   */
  private focusOnRender: string | null = null;

  constructor(context: RoutingPanelContext) {
    this.context = context;
    const { labels } = context.options;

    this.element = el("div");
    this.list = el("ul", RC.waypoints);
    this.list.setAttribute("role", "list");

    const actions = el("div", RC.actions);
    this.addStopButton = button(RC.addStop, labels.addStop);
    this.addStopButton.prepend(icon("add-stop"));
    this.addStopButton.addEventListener("click", () => {
      this.addStop();
    });
    actions.append(this.addStopButton);

    // The design's row holds this one button. Picking a point off the map is
    // reached from inside a field instead — its "Select from map" row, or a
    // right-click on the map — where it is attached to the field it fills
    // rather than being an unlabelled toggle with no visible armed state.

    this.element.append(this.list, actions);
  }

  //#region Rendering

  /** Renders the rows for the current waypoints. */
  render(): void {
    const waypoints = this.context.routing.getWaypoints();
    const { maxWaypoints, renderers, labels, formatters } = this.context.options;

    const custom = renderers.waypointRow;
    const elements: HTMLElement[] = [];
    const seen = new Set<string>();

    waypoints.forEach((waypoint, index) => {
      seen.add(waypoint.id);
      const role = index === 0 ? "origin" : index === waypoints.length - 1 ? "destination" : "stop";

      const replacement = custom?.({ waypoint, index, count: waypoints.length, role, control: this.context.control, labels, formatters });
      elements.push(replacement ?? this.renderRow(waypoint, index, waypoints.length, role));
    });

    for (const [id, row] of this.rows) {
      if (seen.has(id)) continue;
      row.element.remove();
      this.rows.delete(id);
    }

    this.writeRows(elements);
    this.addStopButton.disabled = waypoints.length >= maxWaypoints;
    setBooleanAttribute(this.addStopButton, "aria-disabled", waypoints.length >= maxWaypoints);

    // cleared whether or not the row turned up, so a request from a render ago
    // cannot steal the caret later
    const focusId = this.focusOnRender;
    this.focusOnRender = null;
    if (focusId !== null) this.rows.get(focusId)?.input.focus();
  }

  /**
   * Puts the rows in the list, in order, touching the DOM as little as it can.
   *
   * Rows are reused across renders, so most render passes want the same
   * elements in the same places — and writing them anyway is not free: taking a
   * row out of the document, even to put it straight back, blurs whatever was
   * focused inside it and loses the caret with it. A render can be triggered by
   * something the visitor is not doing — a position arriving, a route
   * recalculating — so that would pull the field out from under them mid-word.
   *
   * The common case is therefore compared and skipped, and the reorder that
   * does have to move rows puts the focus and the selection back afterwards.
   */
  private writeRows(elements: HTMLElement[]): void {
    const current = [...this.list.children];
    if (current.length === elements.length && current.every((node, index) => node === elements[index])) return;

    const active = document.activeElement;
    const focused = active instanceof HTMLElement && this.list.contains(active) ? active : null;
    const selection = focused instanceof HTMLInputElement ? { start: focused.selectionStart, end: focused.selectionEnd } : null;

    this.list.replaceChildren(...elements);

    // a field that belonged to a row this render dropped is gone for good; only
    // one that is still on the page can be handed the caret back
    if (!focused || !this.list.contains(focused)) return;

    focused.focus();
    if (selection && focused instanceof HTMLInputElement) focused.setSelectionRange(selection.start, selection.end);
  }

  /**
   * Builds the copy of the row that is carried under the pointer.
   *
   * It is the whole row rather than the handle — a 24px square says nothing
   * about what is being moved — minus its delete button and any open
   * suggestion list, neither of which is part of what is being carried. The
   * copy lives inside the panel so the panel's own styles apply to it.
   */
  private createGhost(row: WaypointRow): HTMLElement {
    const remove = row.element.querySelector<HTMLElement>(`.${RC.waypointRemove}`);
    const gap = parseFloat(getComputedStyle(row.element).gap) || 0;
    const width = row.element.getBoundingClientRect().width - (remove ? remove.getBoundingClientRect().width + gap : 0);

    const ghost = row.element.cloneNode(true) as HTMLElement;
    ghost.querySelector(`.${RC.waypointRemove}`)?.remove();
    ghost.querySelector(`.${RC.suggestions}`)?.remove();
    ghost.classList.add(RC.waypointGhost);
    ghost.style.width = `${width.toString()}px`;

    // `cloneNode` copies the value *attribute*; the address in the field is a
    // property the panel writes, so without this the carried row comes up with
    // an empty field
    const sources = [...row.element.querySelectorAll("input")];
    ghost.querySelectorAll("input").forEach((clone, index) => {
      const source = sources.at(index);
      if (source) clone.value = source.value;
    });

    this.element.append(ghost);
    return ghost;
  }

  /**
   * Moves the carried copy to the pointer.
   *
   * MapLibre gives every `.maplibregl-ctrl` a `transform: translate(0)`, so a
   * fixed element inside the panel is positioned against the control root
   * rather than the viewport. Rather than guess which ancestor that is, the
   * copy is parked at the origin and measured — the same correction
   * {@link placeFloating} makes for the menus.
   */
  private placeGhost(drag: DragSession, clientX: number, clientY: number): void {
    const ghost = drag.ghost;
    if (!ghost) return;

    ghost.style.left = "0px";
    ghost.style.top = "0px";
    const origin = ghost.getBoundingClientRect();

    ghost.style.left = `${(clientX - drag.offsetX - origin.left).toString()}px`;
    ghost.style.top = `${(clientY - drag.offsetY - origin.top).toString()}px`;
  }

  /**
   * Draws the line the row would land on.
   *
   * Which side of a row it lands on depends on where the pointer is against
   * that row's middle: above means before it, below means after. Without it a
   * drag says nothing about where the row is going.
   */
  private markDropTarget(clientY: number): void {
    const target = this.rowAt(clientY);

    for (const other of this.rows.values()) {
      if (other !== target?.row) delete other.element.dataset.drop;
    }

    if (!target) return;
    // the row being dragged is where it already is; a line on it means nothing
    if (target.row === this.drag?.row) {
      delete target.row.element.dataset.drop;
      return;
    }

    target.row.element.dataset.drop = target.after ? "after" : "before";
  }

  /** Removes every drop line. */
  private clearDropTargets(): void {
    for (const row of this.rows.values()) delete row.element.dataset.drop;
  }

  /**
   * The row a pointer position drops onto.
   *
   * The nearest row centre rather than the row actually under the pointer:
   * rows are 8px apart, and the gaps — along with everything above the first
   * row and below the last — would otherwise leave the drag with no target and
   * no line to show for it.
   */
  private rowAt(clientY: number): DropTarget | null {
    let best: DropTarget | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const [id, row] of this.rows) {
      const rect = row.element.getBoundingClientRect();
      if (rect.height === 0) continue; // a row that is not rendered is not a target

      const centre = rect.top + rect.height / 2;
      const distance = Math.abs(clientY - centre);
      if (distance >= bestDistance) continue;

      bestDistance = distance;
      best = { row, id, after: clientY > centre };
    }

    return best;
  }

  /** Where the dragged row lands, given which edge of the target it fell against. */
  private dropIndex(from: number, target: DropTarget): number {
    const to = this.indexOf(target.id);

    // dropping below a row that sits above the dragged one puts it in that
    // row's place; the indices either side of the gap are the same move
    if (!target.after) return from < to ? Math.max(to - 1, 0) : to;
    return from > to ? to + 1 : to;
  }

  /** Shows the in-field clear button only when there is something to clear. */
  private syncClearButton(row: WaypointRow): void {
    const clear = row.element.querySelector<HTMLButtonElement>(`.${RC.waypointClear}`);
    if (!clear) return;
    clear.hidden = row.input.value.trim() === "";
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

    // never write over what the visitor is typing — but do replace anything
    // else, whoever put it there
    if (!row.editing) {
      row.input.value = waypoint.label ?? (waypoint.lngLat ? formatCoordinate(waypoint.lngLat) : "");
    }

    this.syncClearButton(row);

    const pin = row.element.querySelector<HTMLElement>(`.${RC.waypointPin}`);
    // Search: the From row carries the Circle pin, every other row the Pin one
    if (pin) pin.dataset.icon = role === "origin" ? "pin-circle" : "pin-marker";

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
    // the reorder is driven by pointer events (see beginDrag); a native drag
    // source would race with them and hand the cursor to the browser
    handle.draggable = false;

    const field = el("div", RC.waypointField);
    const pin = icon("pin-marker");
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

    const row: WaypointRow = { element, input, list, activeSuggestion: -1, suggestions: [], editing: false };
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
      row.editing = false;
      row.input.value = "";
      this.syncClearButton(row);
      this.closeSuggestions(row);
      this.context.routing.updateWaypoint(id, { lngLat: null, label: undefined });
      row.input.focus();
    });

    row.input.addEventListener("input", () => {
      row.editing = true;
      this.syncClearButton(row);
      if (!search.enabled) return;
      const { lng, lat } = this.context.map.getCenter();
      // keyed by waypoint id: one geocoder serves every field, and without it
      // typing here would cancel the search another field has queued
      this.context.geocoder.search(
        row.input.value,
        [lng, lat],
        (places) => {
          row.suggestions = places;
          row.activeSuggestion = -1;
          this.renderSuggestions(row, id);
        },
        id,
      );
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
      // whatever was being typed is no longer being typed, so the next render
      // is free to show what the waypoint actually holds
      row.editing = false;

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
    handle?.addEventListener("pointerdown", (event) => {
      this.beginDrag(event, row, id, handle);
    });

    // pointer capture sends every later event to the handle, so these three
    // cover the whole drag wherever the pointer travels
    handle?.addEventListener("pointermove", (event) => {
      this.moveDrag(event);
    });

    handle?.addEventListener("pointerup", (event) => {
      this.finishDrag(event);
    });

    handle?.addEventListener("pointercancel", () => {
      this.endDrag();
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

  /**
   * Takes hold of a row, without moving anything yet.
   *
   * The press is not a drag until the pointer has travelled
   * {@link DRAG_THRESHOLD}: a plain click on the handle has to keep focusing it,
   * which is how the keyboard reordering above is reached. Pointer capture is
   * taken straight away all the same, so a fast drag cannot outrun the handle.
   */
  private beginDrag(event: PointerEvent, row: WaypointRow, id: string, handle: HTMLElement): void {
    if (this.drag) return;
    if (!this.context.options.reorderWaypoints) return;
    // the primary button only, and never a two-finger or right-click gesture
    if (event.button !== 0) return;

    const rect = row.element.getBoundingClientRect();
    const onKeydown = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      this.endDrag();
    };

    this.drag = {
      id,
      index: this.indexOf(id),
      row,
      handle,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      ghost: null,
      cursor: null,
      onKeydown,
    };

    handle.setPointerCapture(event.pointerId);
    document.addEventListener("keydown", onKeydown, true);
  }

  /** Follows the pointer: starts the drag once it has moved, then carries the row. */
  private moveDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    if (!drag.ghost) {
      const travelled = Math.max(Math.abs(event.clientX - drag.startX), Math.abs(event.clientY - drag.startY));
      if (travelled < DRAG_THRESHOLD) return;

      drag.ghost = this.createGhost(drag.row);
      setDataFlag(drag.row.element, "dragging", true);
      // the closed hand belongs to the whole gesture, not just to the handle:
      // the flag carries it across the list, and the page's own cursor is
      // overridden for everywhere else the pointer may travel
      setDataFlag(this.list, "dragging", true);
      drag.cursor = document.body.style.cursor;
      document.body.style.cursor = "grabbing";
    }

    // the press has become a drag, so it is no longer a click on the handle
    event.preventDefault();
    this.placeGhost(drag, event.clientX, event.clientY);
    this.markDropTarget(event.clientY);
  }

  /** Drops the row where the drag left it. */
  private finishDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    // a press that never passed the threshold is a click, not a reorder
    const target = drag.ghost ? this.rowAt(event.clientY) : null;
    const to = target && target.row !== drag.row ? this.dropIndex(drag.index, target) : null;

    this.endDrag();
    if (to !== null) this.context.routing.moveWaypoint(drag.index, to);
  }

  /** Puts everything the drag changed back, whether it dropped or was cancelled. */
  private endDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;

    drag.ghost?.remove();
    if (drag.cursor !== null) document.body.style.cursor = drag.cursor;
    if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    document.removeEventListener("keydown", drag.onKeydown, true);

    setDataFlag(drag.row.element, "dragging", false);
    setDataFlag(this.list, "dragging", false);
    this.clearDropTargets();
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
      const place = row.suggestions.at(row.activeSuggestion === -1 ? 0 : row.activeSuggestion);
      if (place) {
        event.preventDefault();
        this.pick(place, row, id);
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

    // these replace the search results in the same open list, so the places
    // behind them are no longer on offer. Left in place, the keyboard handler
    // would still read them — pressing Enter over "My location" would pick the
    // first result of a search the field no longer even holds the text of.
    row.suggestions = [];
    row.activeSuggestion = -1;

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
      // no trailing chevron: SearchResults carries one, hidden in every variant
      option.append(icon(action.icon), lines);

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

    row.editing = false;
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
        row.editing = false;
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
    if (row.suggestions.length === 0) {
      this.closeSuggestions(row);
      return;
    }

    const fragment = document.createDocumentFragment();

    row.suggestions.forEach((place, index) => {
      const option = el("li", RC.suggestion);
      option.id = `${row.list.id}-option-${index.toString()}`;
      option.setAttribute("role", "option");
      setBooleanAttribute(option, "aria-selected", index === row.activeSuggestion);
      setDataFlag(option, "active", index === row.activeSuggestion);

      const lines = el("span", RC.suggestionLines);
      lines.append(el("span", RC.suggestionPrimary, place.name));
      // a result whose two lines would say the same thing gets one: that is what
      // a provider with a single string to offer produces
      if (place.label !== place.name) lines.append(el("span", RC.suggestionSecondary, place.label));
      option.append(icon("place-area"), lines);

      // pointerdown, not click: the input's blur would otherwise tear the list
      // down before a click could land on it
      option.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        this.pick(place, row, id);
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
    // placed against the viewport rather than the field: the panel body
    // scrolls, and a list positioned inside it is cut off at the panel's edge.
    // Repeated on every render, since the list changes height as the visitor
    // types and may have to flip above the field.
    placeFloating(row.element.querySelector(`.${RC.waypointField}`) ?? row.input, row.list, true);
    this.scrollParent()?.addEventListener("scroll", this.onPanelScroll, { passive: true });
  }

  /** Closes one row's suggestion list. */
  private closeSuggestions(row: WaypointRow): void {
    if (![...this.rows.values()].some((other) => other !== row && !other.list.hidden)) {
      this.scrollParent()?.removeEventListener("scroll", this.onPanelScroll);
    }

    row.list.hidden = true;
    row.list.replaceChildren();
    row.activeSuggestion = -1;
    row.input.setAttribute("aria-expanded", "false");
    row.input.removeAttribute("aria-activedescendant");
  }

  /** The list is placed against the viewport, so it follows its field. */
  private readonly onPanelScroll = (): void => {
    const parent = this.scrollParent();
    const bounds = parent?.getBoundingClientRect();

    for (const row of this.rows.values()) {
      if (row.list.hidden) continue;

      const field = row.element.querySelector<HTMLElement>(`.${RC.waypointField}`) ?? row.input;
      const anchor = field.getBoundingClientRect();

      // once its field has scrolled out of the panel there is nothing left to
      // attach the list to
      if (bounds && (anchor.bottom < bounds.top || anchor.top > bounds.bottom)) {
        this.closeSuggestions(row);
        continue;
      }

      placeFloating(field, row.list, true);
    }
  };

  /** The panel body, which is what scrolls under an open list. */
  private scrollParent(): HTMLElement | null {
    return this.element.closest<HTMLElement>(`.${RC.body}`);
  }

  /** Closes every open suggestion list, e.g. when the map is interacted with. */
  closeAllSuggestions(): void {
    for (const row of this.rows.values()) this.closeSuggestions(row);
  }

  private pick(place: RoutingPlace, row: WaypointRow, id: string): void {
    row.editing = false;
    row.input.value = place.label;
    this.closeSuggestions(row);
    this.context.routing.updateWaypoint(id, { lngLat: place.lngLat, label: place.label });
  }

  private addStop(): void {
    const waypoints = this.context.routing.getWaypoints();
    // a new stop belongs before the destination, which is where a user adding
    // one to an existing route expects it
    const added = this.context.routing.addWaypoint({}, Math.max(waypoints.length - 1, 0));

    // an empty stop is added in order to be filled in: the caret goes to it, so
    // the next keystroke lands there instead of needing a click first
    this.focusOnRender = added.id;
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
