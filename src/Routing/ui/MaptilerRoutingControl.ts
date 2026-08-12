import maplibregl from "maplibre-gl";
import type { IControl, MapMouseEvent } from "maplibre-gl";
import type { Map as SDKMap } from "../../Map";
import { DOMremove } from "../../utils/dom";
import type { RoutingController } from "../RoutingController";
import { FiltersView } from "./routing-filters-view";
import { RoutingGeocoder } from "./routing-geocoder";
import { ResultsView } from "./routing-results-view";
import { CSS_VARS, RC, resolveControlOptions, type ResolvedControlOptions } from "./routing-ui-defaults";
import type { RoutingPanelContext } from "./routing-ui-context";
import { RenderQueue, button, el, setBooleanAttribute, setDataFlag } from "./routing-ui-dom";
import type { MaptilerRoutingControlOptions, RoutingControlTheme, RoutingPanelStatus } from "./routing-ui-types";
import { WaypointsView } from "./routing-waypoints-view";

/** Regions the panel re-renders independently. */
const REGION = {
  WAYPOINTS: "waypoints",
  FILTERS: "filters",
  RESULTS: "results",
} as const;

/** Events MapLibre's own handlers would otherwise act on while the pointer is over the panel. */
const SWALLOWED_EVENTS = ["wheel", "dblclick", "contextmenu", "mousedown", "touchstart"] as const;

/**
 * Maps that already have a routing panel.
 *
 * A second control is allowed — both are views of the same session — but it is
 * worth warning about, since it is far more often a mistake than a choice.
 */
const MAPS_WITH_PANEL = new WeakSet<SDKMap>();

/**
 * A directions panel: transport modes, waypoints with place search,
 * filters, route alternatives and turn-by-turn directions.
 *
 * The control owns only the UI. All routing state lives in the map's
 * {@link RoutingController}, which it shares with anyone using the headless
 * API on the same map — so a route set programmatically shows up in the panel,
 * and a route built in the panel is readable programmatically.
 *
 * @example
 * ```ts
 * map.addControl(
 *   new MaptilerRoutingControl({
 *     modes: ["car", "bicycle"],
 *     filters: ["departure", "units"],
 *     theme: { accent: "#e2001a" },
 *   }),
 *   "top-left",
 * );
 * ```
 *
 * @remarks
 * **API Key Usage**: each computed route counts against your MapTiler Cloud
 * API key quota. Place search additionally uses the Geocoding API.
 */
export class MaptilerRoutingControl extends maplibregl.Evented implements IControl {
  private readonly options: ResolvedControlOptions;
  private readonly userOptions: MaptilerRoutingControlOptions;

  private map?: SDKMap;
  private routing?: RoutingController;
  private root?: HTMLElement;
  private body?: HTMLElement;

  private waypointsView?: WaypointsView;
  private filtersView?: FiltersView;
  private resultsView?: ResultsView;
  private queue?: RenderQueue;

  private geocoder?: RoutingGeocoder;
  private collapsed: boolean;
  private picking = false;
  private savedCursor = "";

  /**
   * Waypoints a name has already been requested for.
   *
   * A waypoint supplied as a bare coordinate — from the options, from a map
   * click or from a drag — has no label, and showing the coordinate forever
   * would be a poor first impression. Each one is named once; the set stops a
   * failed lookup from being retried on every render.
   */
  private readonly namedWaypoints = new Set<string>();

  /** Everything to undo in `onRemove`, collected as one closure. */
  private dispose: (() => void)[] = [];

  constructor(options: MaptilerRoutingControlOptions = {}) {
    super();
    this.userOptions = options;
    this.options = resolveControlOptions(options);
    this.collapsed = this.options.collapsed;
  }

  //#region IControl

  /** Builds the panel and attaches it to the map. Called by MapLibre. */
  onAdd(map: SDKMap): HTMLElement {
    this.map = map;

    // share the map's routing session, creating it when this control is the
    // first thing to need it
    this.routing = map.getRouting() ?? map.enableRouting(this.sessionOptions());

    if (MAPS_WITH_PANEL.has(map)) {
      console.warn("[MaptilerRoutingControl]: A routing control is already attached to this map. Both panels will mirror the same routing session.");
    }
    MAPS_WITH_PANEL.add(map);
    this.dispose.push(() => MAPS_WITH_PANEL.delete(map));

    const geocoder = new RoutingGeocoder(this.options.search);
    this.geocoder = geocoder;
    this.queue = new RenderQueue((regions) => {
      this.flush(regions);
    });

    const context: RoutingPanelContext = {
      control: this,
      map,
      routing: this.routing,
      options: this.options,
      geocoder,
      invalidate: (region) => this.queue?.schedule(region),
    };

    const waypointsView = new WaypointsView(context);
    const filtersView = new FiltersView(context);
    const resultsView = new ResultsView(context);
    this.waypointsView = waypointsView;
    this.filtersView = filtersView;
    this.resultsView = resultsView;

    // the session may already hold results — it outlives any single control,
    // so the panel starts from what is there rather than from an empty state
    resultsView.setStatus(this.initialStatus());

    this.root = this.buildShell([filtersView.element, waypointsView.element, resultsView.element]);
    this.applyTheme();
    this.wirePanelEvents();
    this.wireRoutingEvents();
    this.wireMapEvents();

    this.render();
    this.options.onCreate?.(this.root, this as never);
    this.dispose.push(() => {
      geocoder.cancel();
    });

    return this.root;
  }

  /** Detaches the panel and undoes everything it installed. Called by MapLibre. */
  onRemove(): void {
    for (const undo of this.dispose) undo();
    this.dispose = [];

    this.queue?.cancel();
    this.setPicking(false);

    if (this.root) DOMremove(this.root);

    this.root = undefined;
    this.body = undefined;
    this.map = undefined;
    this.routing = undefined;
    this.waypointsView = undefined;
    this.filtersView = undefined;
    this.resultsView = undefined;
    this.queue = undefined;
  }

  /** Corner used when the control is added through the map option. */
  getDefaultPosition(): ReturnType<NonNullable<IControl["getDefaultPosition"]>> {
    return this.options.position;
  }

  //#endregion

  //#region Shell

  /**
   * Builds the panel shell around the views.
   *
   * @param views - Root elements of the views, in display order.
   */
  private buildShell(views: HTMLElement[]): HTMLElement {
    const { labels, collapsible, className, unstyled } = this.options;

    // the MapLibre control class gives the panel its corner positioning; the
    // routing class is what every shipped style rule is scoped under, so
    // dropping it is how `unstyled` works
    const root = el("div", ["maplibregl-ctrl", unstyled ? "" : RC.root, className ?? ""].filter(Boolean).join(" "));
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", labels.title);
    root.dataset.profile = this.routing?.getProfile() ?? "car";

    const body = el("div", RC.body);
    body.id = `maptiler-routing-body-${Math.random().toString(36).slice(2, 8)}`;
    this.body = body;

    if (collapsible) {
      const header = el("div", RC.header);
      header.append(el("h2", RC.title, labels.title));

      const toggle = button(RC.toggle, labels.toggle, "chevron-up");
      toggle.setAttribute("aria-controls", body.id);
      toggle.addEventListener("click", () => {
        this.toggle();
      });

      header.append(toggle);
      root.append(header);
    }

    const listView = el("div", RC.view);
    listView.dataset.view = "list";
    listView.append(...views);

    body.append(listView);
    root.append(body);

    const footer = this.options.renderers.footer?.({ control: this, labels, formatters: this.options.formatters });
    if (footer) root.append(footer);

    this.applyCollapsed();
    return root;
  }

  /** Writes the theme values as CSS custom properties on the panel root. */
  private applyTheme(): void {
    if (!this.root) return;

    for (const [key, value] of Object.entries(this.options.theme)) {
      const property = CSS_VARS[key as keyof RoutingControlTheme];
      if (property && value) this.root.style.setProperty(property, value);
    }

    for (const [property, value] of Object.entries(this.options.cssVariables)) {
      this.root.style.setProperty(property, value);
    }
  }

  /** Panel status implied by the session the control just attached to. */
  private initialStatus(): RoutingPanelStatus {
    const routing = this.routing;
    if (!routing) return "idle";
    if (routing.isCalculating()) return "loading";
    if (routing.getRoutes().length > 0) return "ready";
    return routing.getWaypoints().filter((waypoint) => waypoint.lngLat).length >= 2 ? "loading" : "idle";
  }

  /** Options forwarded to the routing session when this control creates it. */
  private sessionOptions() {
    return {
      profiles: this.options.modes.map((mode) => mode.id),
      profile: this.options.profile ?? this.options.modes[0]?.id,
      units: this.options.units,
      language: this.options.language,
      alternates: this.options.alternates,
      waypoints: this.options.waypoints ? [...this.options.waypoints] : [{}, {}],
      fitBounds: this.options.fitBoundsOnResult ? undefined : (false as const),
      waypointMarkers: { draggable: this.options.dragWaypointsOnMap },
    };
  }

  //#endregion

  //#region Wiring

  private wirePanelEvents(): void {
    const root = this.root;
    if (!root) return;

    // MapLibre binds its handlers on the map container, which is this panel's
    // ancestor: left alone, the wheel zooms the map while scrolling the route
    // list, and a double-click on a step zooms in.
    for (const type of SWALLOWED_EVENTS) {
      const handler = (event: Event) => {
        event.stopPropagation();
      };
      root.addEventListener(type, handler);
      this.dispose.push(() => {
        root.removeEventListener(type, handler);
      });
    }

    // DragPan calls preventDefault on mousedown over the map container, which
    // is what normally moves focus — without this, clicking a waypoint field
    // would not focus it and typing would go nowhere.
    const focusHandler = (event: PointerEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("input, button, select, textarea, [tabindex]");
      if (target) target.focus();
    };
    root.addEventListener("pointerdown", focusHandler, true);
    this.dispose.push(() => {
      root.removeEventListener("pointerdown", focusHandler, true);
    });

    // Escape closes what is open, innermost first
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (this.picking) {
        this.setPicking(false);
        event.stopPropagation();
      }
    };
    root.addEventListener("keydown", keyHandler);
    this.dispose.push(() => {
      root.removeEventListener("keydown", keyHandler);
    });
  }

  private wireRoutingEvents(): void {
    const routing = this.routing;
    if (!routing) return;

    const onWaypoints = () => {
      this.queue?.schedule(REGION.WAYPOINTS);
      if (routing.getWaypoints().filter((waypoint) => waypoint.lngLat).length < 2) {
        this.resultsView?.setStatus("idle");
        this.queue?.schedule(REGION.RESULTS);
      }
    };
    const onStart = () => {
      this.resultsView?.setStatus("loading");
      this.queue?.schedule(REGION.RESULTS);
    };
    const onRoutes = () => {
      this.resultsView?.setStatus(routing.getRoutes().length > 0 ? "ready" : "empty");
      this.queue?.schedule(REGION.RESULTS);
    };
    const onSelect = () => this.queue?.schedule(REGION.RESULTS);
    const onError = (event: { error: Error }) => {
      this.resultsView?.setStatus("error", event.error);
      this.queue?.schedule(REGION.RESULTS);
    };
    const onClear = () => {
      this.resultsView?.setStatus("idle");
      this.queue?.schedule(REGION.RESULTS);
    };

    routing.on("routingwaypoints", onWaypoints);
    routing.on("routingstart", onStart);
    routing.on("routingroutes", onRoutes);
    routing.on("routingselect", onSelect);
    routing.on("routingerror", onError);
    routing.on("routingclear", onClear);

    this.dispose.push(() => {
      routing.off("routingwaypoints", onWaypoints);
      routing.off("routingstart", onStart);
      routing.off("routingroutes", onRoutes);
      routing.off("routingselect", onSelect);
      routing.off("routingerror", onError);
      routing.off("routingclear", onClear);
    });
  }

  private wireMapEvents(): void {
    const map = this.map;
    if (!map) return;

    const onMapClick = (event: MapMouseEvent) => {
      this.waypointsView?.closeAllSuggestions();
      if (this.options.clickToAddWaypoint === "off") return;
      if (this.options.clickToAddWaypoint === "armed" && !this.picking) return;

      // a click that landed on the route selects it; only empty map adds a stop
      if (map.queryRenderedFeatures(event.point, { layers: this.routeLayerIds() }).length > 0) return;

      this.addWaypointFromMap([event.lngLat.lng, event.lngLat.lat]);
      if (this.options.clickToAddWaypoint === "armed") this.setPicking(false);
    };

    const onMoveStart = () => this.waypointsView?.closeAllSuggestions();

    map.on("click", onMapClick);
    map.on("movestart", onMoveStart);

    this.dispose.push(() => {
      map.off("click", onMapClick);
      map.off("movestart", onMoveStart);
    });
  }

  /** Route layer ids that exist on the map right now. */
  private routeLayerIds(): string[] {
    const map = this.map;
    if (!map) return [];
    return ["maptiler-routing-route-hitbox", "maptiler-routing-route-line"].filter((id) => map.getLayer(id));
  }

  /** Adds a waypoint picked on the map, then names it in the background. */
  private addWaypointFromMap(lngLat: [number, number]): void {
    const routing = this.routing;
    if (!routing) return;

    const waypoints = routing.getWaypoints();
    // fill the first empty row if there is one, otherwise insert before the
    // destination, which is where a user adding a stop expects it
    const emptyIndex = waypoints.findIndex((waypoint) => waypoint.lngLat === null);

    const id =
      emptyIndex === -1
        ? routing.addWaypoint({ lngLat }, Math.max(waypoints.length - 1, 0)).id
        : (routing.updateWaypoint(waypoints[emptyIndex].id, { lngLat }), waypoints[emptyIndex].id);

    this.nameWaypoint(id, lngLat);
  }

  /**
   * Puts a place name on a waypoint that only has a coordinate.
   *
   * Runs in the background: the route is computed from the coordinate and does
   * not wait for the name, and a failed lookup leaves the coordinate showing.
   */
  private nameWaypoint(id: string, lngLat: [number, number]): void {
    if (!this.options.search.enabled || this.namedWaypoints.has(id)) return;
    this.namedWaypoints.add(id);

    void this.geocoder?.reverse(lngLat).then((label) => {
      if (label) this.routing?.updateWaypoint(id, { label });
    });
  }

  /** Names every waypoint that has a position but no label yet. */
  private nameUnlabeledWaypoints(): void {
    for (const waypoint of this.routing?.getWaypoints() ?? []) {
      if (waypoint.lngLat && waypoint.label === undefined) this.nameWaypoint(waypoint.id, waypoint.lngLat);
    }
  }

  //#endregion

  //#region Rendering

  private render(): void {
    this.flush(new Set([REGION.WAYPOINTS, REGION.FILTERS, REGION.RESULTS]));
  }

  private flush(regions: ReadonlySet<string>): void {
    if (!this.root) return;

    if (regions.has(REGION.FILTERS)) this.filtersView?.render();
    if (regions.has(REGION.WAYPOINTS)) {
      this.waypointsView?.render();
      this.nameUnlabeledWaypoints();
    }
    if (regions.has(REGION.RESULTS)) this.resultsView?.render();

    this.root.dataset.profile = this.routing?.getProfile() ?? "car";
    this.root.dataset.units = this.routing?.getUnits() ?? "km";
    this.root.dataset.status = this.resultsView?.getStatus() ?? "idle";
    setDataFlag(this.root, "picking", this.picking);
  }

  private applyCollapsed(): void {
    if (!this.root || !this.body) return;

    this.body.hidden = this.collapsed;
    setDataFlag(this.root, "collapsed", this.collapsed);

    const toggle = this.root.querySelector<HTMLButtonElement>(`.${RC.toggle}`);
    if (toggle) setBooleanAttribute(toggle, "aria-expanded", !this.collapsed);
  }

  //#endregion

  //#region Public API

  /** The panel's root element, for a consumer that needs to decorate it. */
  getElement(): HTMLElement | undefined {
    return this.root;
  }

  /** The routing session this panel renders — the programmatic API. */
  getRouting(): RoutingController | undefined {
    return this.routing;
  }

  /** Expands the panel. */
  open(): this {
    this.collapsed = false;
    this.applyCollapsed();
    this.fire("routinguiopen", {});
    return this;
  }

  /** Collapses the panel to its header. */
  collapse(): this {
    this.collapsed = true;
    this.applyCollapsed();
    this.fire("routinguicollapse", {});
    return this;
  }

  /** Collapses the panel if it is open, expands it otherwise. */
  toggle(): this {
    return this.collapsed ? this.open() : this.collapse();
  }

  /** Shows the route list. */
  showRouteList(): this {
    this.resultsView?.showRoutes();
    return this;
  }

  /**
   * Shows the turn-by-turn directions.
   *
   * @param index - Route to show. Defaults to the selected one.
   */
  showRouteDetail(index?: number): this {
    if (index !== undefined) this.routing?.selectRoute(index);
    this.resultsView?.showDetail();
    return this;
  }

  /**
   * Arms or disarms picking a waypoint by clicking the map.
   *
   * No-op when `clickToAddWaypoint` is `"off"` or `"always"`, where there is
   * nothing to arm.
   */
  togglePickOnMap(): this {
    if (this.options.clickToAddWaypoint !== "armed") return this;
    this.setPicking(!this.picking);
    return this;
  }

  /** Re-renders the whole panel from the current session state. */
  refresh(): this {
    this.render();
    return this;
  }

  /** The options this control was constructed with, before defaults were applied. */
  getOptions(): MaptilerRoutingControlOptions {
    return this.userOptions;
  }

  //#endregion

  //#region Picking

  private setPicking(picking: boolean): void {
    if (this.picking === picking) return;
    this.picking = picking;

    const canvas = this.map?.getCanvas();
    if (canvas) {
      if (picking) {
        // saved rather than assumed empty: another control may have set it
        this.savedCursor = canvas.style.cursor;
        canvas.style.cursor = "crosshair";
      } else {
        canvas.style.cursor = this.savedCursor;
      }
    }

    this.waypointsView?.setPicking(picking);
    if (this.root) setDataFlag(this.root, "picking", picking);
    this.fire(picking ? "routinguipickstart" : "routinguipickend", {});
  }

  //#endregion
}
