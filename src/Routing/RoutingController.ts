import maplibregl from "maplibre-gl";
import type { Subscription } from "maplibre-gl";
import type { Map as SDKMap } from "../Map";
import { RouteRenderer } from "./RouteRenderer";
import { routing } from "./routing-api";
import { resolveRoutingOptions, type ResolvedRoutingOptions } from "./routing-constants";
import { getCoordinatesBounds, getRoutesBounds, type RouteBounds } from "./routing-geometry";
import { buildDirectionsRequest } from "./routing-request";
import { flattenRouteSteps, getStepCoordinates, type FlatRouteStep } from "./routing-steps";
import { insertWaypoint, moveWaypoint, removeWaypoint, toWaypoint, waypointsEqual } from "./routing-waypoints";
import type {
  DirectionsResponse,
  ProfileOptionsFor,
  Route,
  RouteFitBoundsOptions,
  RoutingOptions,
  RoutingProfile,
  RoutingProfileOptions,
  RoutingEventType,
  RoutingUnits,
  RoutingWaypoint,
  RoutingWaypointInput,
  RoutingWaypointsChangeReason,
} from "./types";

/** Listener shape of the typed `on`/`once`/`off` overloads. */
type RoutingEventListener = (event: RoutingEventType[keyof RoutingEventType]) => void;

/**
 * MapLibre's own listener type, which is intentionally untyped. The typed
 * overloads narrow it for consumers and cast back to it at the boundary.
 */
type EventedListener = Parameters<maplibregl.Evented["on"]>[1];

/**
 * A routing session attached to one map.
 *
 * Holds the waypoints and configuration, talks to the Routing API, draws the
 * result, and reports what happened through events. One controller exists per
 * map; get it with {@link Map.enableRouting} or {@link Map.getRouting}.
 *
 * @example
 * ```ts
 * const routing = map.enableRouting({ profile: "bicycle", alternates: 2 });
 *
 * routing.setWaypoints([
 *   [8.54, 47.37],
 *   [12.87, 50.23],
 * ]);
 *
 * routing.on("routingroutes", (event) => {
 *   console.log(`${event.routes.length} routes`);
 * });
 * ```
 *
 * @remarks
 * Every request consumes MapTiler Cloud API quota. Changes are coalesced
 * behind a debounce, so a burst of edits costs one request.
 */
export class RoutingController extends maplibregl.Evented {
  private readonly map: SDKMap;
  private options: ResolvedRoutingOptions;
  private readonly renderer: RouteRenderer;

  private waypoints: RoutingWaypoint[] = [];
  private routes: Route[] = [];
  private selectedIndex = -1;
  private response?: DirectionsResponse;

  private calculating = false;
  private abortController: AbortController | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(map: SDKMap, options: RoutingOptions = {}) {
    super();

    this.map = map;
    this.options = resolveRoutingOptions(options);

    this.renderer = new RouteRenderer(map, this.options.render, this.options.waypointMarkers, {
      onRouteClick: (index) => {
        if (this.options.selectRouteOnClick) this.selectRoute(index);
      },
      onWaypointDragEnd: (id, lngLat) => {
        // the geocoded label no longer describes the point once it has moved
        this.updateWaypoint(id, { lngLat, label: undefined });
      },
    });

    if (options.waypoints?.length) {
      this.setWaypoints(options.waypoints);
    }

    void this.map.once("remove", () => {
      this.destroy();
    });
  }

  //#region Events

  /**
   * Subscribes to a routing event.
   *
   * @param type - Event name. See {@link RoutingEventType} for the payloads.
   * @param listener - Called with the event payload.
   *
   * @example
   * ```ts
   * routing.on("routingroutes", (event) => {
   *   // event.routes is typed
   *   console.log(event.routes[event.selectedIndex].summary.totalTime);
   * });
   * ```
   */
  override on<T extends keyof RoutingEventType>(type: T, listener: (event: RoutingEventType[T]) => void): Subscription;
  override on(type: string, listener: RoutingEventListener): Subscription {
    return super.on(type, listener as EventedListener);
  }

  /** Subscribes to a routing event for one firing only. */
  override once<T extends keyof RoutingEventType>(type: T, listener: (event: RoutingEventType[T]) => void): this;
  override once(type: string, listener?: RoutingEventListener): this | Promise<unknown> {
    return super.once(type, listener as EventedListener) as this;
  }

  /** Removes a previously added listener. */
  override off<T extends keyof RoutingEventType>(type: T, listener: (event: RoutingEventType[T]) => void): this;
  override off(type: string, listener: RoutingEventListener): this {
    return super.off(type, listener as EventedListener);
  }

  //#endregion

  //#region Waypoints

  /** The current waypoints, including any placeholder rows that have no position. */
  getWaypoints(): RoutingWaypoint[] {
    return [...this.waypoints];
  }

  /** Replaces the whole waypoint list. */
  setWaypoints(waypoints: RoutingWaypointInput[]): this {
    return this.applyWaypoints(waypoints.map(toWaypoint), "set");
  }

  /**
   * Adds a waypoint.
   *
   * @param waypoint - The waypoint to add.
   * @param index - Where to insert it. Appends when omitted.
   * @returns The waypoint that was added, so its generated id can be kept.
   */
  addWaypoint(waypoint: RoutingWaypointInput, index?: number): RoutingWaypoint {
    const added = toWaypoint(waypoint);
    this.applyWaypoints(insertWaypoint(this.waypoints, added, index), "add");
    return added;
  }

  /** Updates one waypoint in place, leaving the fields the patch omits untouched. */
  updateWaypoint(id: string, patch: Partial<Omit<RoutingWaypoint, "id">>): this {
    const next = this.waypoints.map((waypoint) => (waypoint.id === id ? { ...waypoint, ...patch } : waypoint));
    return this.applyWaypoints(next, "update");
  }

  /** Removes a waypoint by id. Unknown ids are ignored. */
  removeWaypoint(id: string): this {
    return this.applyWaypoints(removeWaypoint(this.waypoints, id), "remove");
  }

  /** Moves a waypoint to another position in the list. */
  moveWaypoint(from: number, to: number): this {
    return this.applyWaypoints(moveWaypoint(this.waypoints, from, to), "move");
  }

  /** Removes every waypoint and the drawn route with them. */
  clearWaypoints(): this {
    return this.applyWaypoints([], "clear");
  }

  /**
   * Commits a new waypoint list: updates the markers, fires the change event,
   * and recomputes when the change would produce a different request.
   */
  private applyWaypoints(next: RoutingWaypoint[], reason: RoutingWaypointsChangeReason): this {
    if (this.destroyed) return this;

    const previous = this.waypoints;
    // a same-reference result means the operation was a no-op (an unknown id,
    // a move to the same index), which is not worth an event
    if (next === previous) return this;

    this.waypoints = next;
    this.renderer.setWaypoints(next);
    this.fireEvent("routingwaypoints", { waypoints: this.getWaypoints(), reason });

    // labels do not reach the API, so a label-only edit must not re-request
    if (!waypointsEqual(previous, next)) this.invalidate();

    return this;
  }

  //#endregion

  //#region Configuration

  /** The profile the next request will use. */
  getProfile(): RoutingProfile {
    return this.options.profile;
  }

  /**
   * Sets the transport profile.
   *
   * @param profile - One of the profiles this session allows.
   * @remarks A profile outside {@link RoutingController.getAvailableProfiles}
   * is ignored with a warning, so a UI cannot silently request a mode the
   * application meant to hide.
   */
  setProfile(profile: RoutingProfile): this {
    if (!this.options.profiles.includes(profile)) {
      console.warn(`[RoutingController.setProfile]: The profile "${profile}" is not one of the profiles this routing session allows. Keeping "${this.options.profile}".`);
      return this;
    }

    if (this.options.profile === profile) return this;

    this.options.profile = profile;
    this.fireEvent("routingconfig", { change: "profile" });
    return this.invalidate();
  }

  /** The profiles this session allows, in display order. */
  getAvailableProfiles(): readonly RoutingProfile[] {
    return this.options.profiles;
  }

  /** The profile-specific tuning the next request will use. */
  getProfileOptions(): RoutingProfileOptions {
    return { ...this.options.profileOptions };
  }

  /**
   * Sets the profile-specific tuning.
   *
   * @remarks Overwrites rather than merges. Options that do not apply to the
   * current profile are dropped when the request is built.
   */
  setProfileOptions<P extends RoutingProfile>(options: ProfileOptionsFor<P>): this {
    this.options.profileOptions = options;
    this.fireEvent("routingconfig", { change: "profileOptions" });
    return this.invalidate();
  }

  /** The distance unit used for the request and reported in the results. */
  getUnits(): RoutingUnits {
    return this.options.units;
  }

  /** Sets the distance unit. */
  setUnits(units: RoutingUnits): this {
    if (this.options.units === units) return this;
    this.options.units = units;
    this.fireEvent("routingconfig", { change: "units" });
    return this.invalidate();
  }

  /** Sets the local departure time as `YYYY-MM-DDTHH:mm`, or clears it with `null`. */
  setDepartureTime(time: string | null): this {
    const next = time ?? undefined;
    if (this.options.departureTime === next) return this;
    this.options.departureTime = next;
    this.fireEvent("routingconfig", { change: "departureTime" });
    return this.invalidate();
  }

  /** Sets the local arrival time as `YYYY-MM-DDTHH:mm`, or clears it with `null`. */
  setArrivalTime(time: string | null): this {
    const next = time ?? undefined;
    if (this.options.arrivalTime === next) return this;
    this.options.arrivalTime = next;
    this.fireEvent("routingconfig", { change: "arrivalTime" });
    return this.invalidate();
  }

  /** Sets how many alternative routes to request. */
  setAlternates(count: number): this {
    const next = Math.max(0, Math.floor(count));
    if (this.options.alternates === next) return this;
    this.options.alternates = next;
    this.fireEvent("routingconfig", { change: "alternates" });
    return this.invalidate();
  }

  //#endregion

  //#region Results

  /** The routes from the last successful request, best route first. */
  getRoutes(): Route[] {
    return [...this.routes];
  }

  /** Index of the selected route, or `-1` when nothing is drawn. */
  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  /** The selected route, or `undefined` when nothing is drawn. */
  getSelectedRoute(): Route | undefined {
    return this.routes[this.selectedIndex];
  }

  /**
   * Selects one of the drawn routes.
   *
   * @param index - Index within {@link RoutingController.getRoutes}, clamped
   * to the available range.
   */
  selectRoute(index: number): this {
    if (this.destroyed || this.routes.length === 0) return this;

    const next = Math.min(Math.max(index, 0), this.routes.length - 1);
    if (next === this.selectedIndex) return this;

    const previousIndex = this.selectedIndex;
    this.selectedIndex = next;
    this.renderer.setRoutes(this.routes, next);

    this.fireEvent("routingselect", { selectedIndex: next, previousIndex, route: this.routes[next] });
    return this;
  }

  /** Every step of the selected route, flattened across its legs. */
  getSteps(): FlatRouteStep[] {
    const route = this.getSelectedRoute();
    return route ? flattenRouteSteps(route) : [];
  }

  /** Attribution text from the last response, which must be shown alongside the route. */
  getAttribution(): string | undefined {
    return this.response?.attribution;
  }

  /**
   * Frames one step of the selected route.
   *
   * @param step - A step from {@link RoutingController.getSteps}.
   * @param options - Camera options for this move only.
   */
  zoomToStep(step: FlatRouteStep, options?: RouteFitBoundsOptions): this {
    const route = this.getSelectedRoute();
    if (!route) return this;

    const coordinates = getStepCoordinates(route, step);
    if (coordinates.length === 0) return this;

    if (coordinates.length === 1) {
      this.map.flyTo({ center: coordinates[0], zoom: 16, ...options });
      return this;
    }

    const bounds = getCoordinatesBounds(coordinates);
    if (bounds) this.fitToBounds(bounds, { maxZoom: 16, ...options });
    return this;
  }

  /** Frames every drawn route. */
  fitBounds(options?: RouteFitBoundsOptions): this {
    const bounds = getRoutesBounds(this.routes);
    if (bounds) this.fitToBounds(bounds, options);
    return this;
  }

  private fitToBounds(bounds: RouteBounds, options?: RouteFitBoundsOptions): void {
    const base = this.options.fitBounds === false ? {} : this.options.fitBounds;
    this.map.fitBounds(bounds, { ...base, ...options });
  }

  //#endregion

  //#region Lifecycle

  /** `true` while a request is in flight. */
  isCalculating(): boolean {
    return this.calculating;
  }

  /**
   * Computes the route now, bypassing the debounce.
   *
   * @returns The routes, or an empty array when fewer than two waypoints have
   * a position — a half-filled form is a normal state, not an error.
   */
  async calculate(): Promise<Route[]> {
    if (this.destroyed) return [];

    this.cancelPendingRun();

    const request = buildDirectionsRequest({
      profile: this.options.profile,
      profileOptions: this.options.profileOptions,
      waypoints: this.waypoints,
      units: this.options.units,
      language: this.options.language,
      alternates: this.options.alternates,
      detailLevel: this.options.detailLevel,
      departureTime: this.options.departureTime,
      arrivalTime: this.options.arrivalTime,
    });

    if (!request) {
      this.clear();
      return [];
    }

    const controller = new AbortController();
    this.abortController = controller;
    this.calculating = true;
    this.fireEvent("routingstart", { request });

    try {
      const response = await routing.directions(request, {
        apiKey: this.options.apiKey,
        signal: controller.signal,
      });

      if (controller.signal.aborted || this.isDestroyed()) return [];

      const routes = [response.route, ...(response.alternates ?? [])].filter(Boolean);

      this.response = response;
      this.routes = routes;
      this.selectedIndex = routes.length > 0 ? 0 : -1;
      this.renderer.setRoutes(routes, this.selectedIndex);

      // framed once per response, never on selection change: re-framing while
      // the user compares alternates yanks the map away from what they read
      if (this.options.fitBounds !== false && routes.length > 0) this.fitBounds();

      this.fireEvent("routingroutes", { routes: this.getRoutes(), selectedIndex: this.selectedIndex, response });
      return routes;
    } catch (error) {
      // an abort is this module's own doing, not a failure to report
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return [];
      if (this.isDestroyed()) return [];

      this.fireEvent("routingerror", { error: error instanceof Error ? error : new Error(String(error)) });
      return [];
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
        this.calculating = false;
      }
    }
  }

  /** Aborts the request in flight, if any. No error event is fired for it. */
  cancel(): this {
    this.cancelPendingRun();
    this.calculating = false;
    return this;
  }

  /** Removes the drawn routes and the stored results, keeping the waypoints. */
  clear(): this {
    if (this.destroyed) return this;
    if (this.routes.length === 0 && this.selectedIndex === -1) return this;

    this.routes = [];
    this.selectedIndex = -1;
    this.response = undefined;
    this.renderer.clearRoutes();
    this.fireEvent("routingclear", {});
    return this;
  }

  /** Detaches everything: layers, markers, listeners and any request in flight. */
  destroy(): void {
    if (this.destroyed) return;

    this.cancelPendingRun();
    this.destroyed = true;
    this.calculating = false;
    this.renderer.destroy();
    this.routes = [];
    this.selectedIndex = -1;
  }

  //#endregion

  //#region Internal

  /** Schedules a recompute, coalescing a burst of changes into one request. */
  private invalidate(): this {
    if (this.destroyed || !this.options.autoCalculate) return this;

    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.calculate();
    }, this.options.debounce);

    return this;
  }

  /** Drops the pending debounce and aborts the request in flight. */
  private cancelPendingRun(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * `true` once {@link RoutingController.destroy} has run.
   *
   * Read through a method rather than the field directly in async paths:
   * the compiler narrows `this.destroyed` to `false` for the rest of a method
   * body after an early return, which is wrong across an `await` — the map can
   * be removed while a request is in flight.
   */
  private isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Fires an event with the fields every routing event carries. */
  private fireEvent(type: string, payload: Record<string, unknown>): void {
    this.fire(type, { type, target: this.map, controller: this, ...payload });
  }

  //#endregion
}
