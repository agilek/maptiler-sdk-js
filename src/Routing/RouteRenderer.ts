import type { FeatureCollection, LineString } from "geojson";
import type { GeoJSONSource, MapMouseEvent, MarkerOptions, StyleSpecification } from "maplibre-gl";
import { Marker } from "../MLAdapters/Marker";
import type { Map as SDKMap } from "../Map";
import {
  ROUTE_HITBOX_LAYER_ID,
  ROUTE_LAYER_IDS,
  ROUTE_SOURCE_ID,
  type ResolvedRenderOptions,
  type ResolvedRouteLabelOptions,
  type ResolvedWaypointMarkerOptions,
} from "./routing-constants";
import { EMPTY_ROUTE_COLLECTION, buildRouteFeatureCollection, buildRouteLayers, firstSymbolLayerId, type RouteFeatureProperties } from "./routing-layers";
import { getLineMidpoint, getRouteCoordinates } from "./routing-geometry";
import type { Route, RoutingWaypoint } from "./types";

/** Class of the travel-time badge. Part of the documented styling contract. */
const ROUTE_LABEL_CLASS = "maptiler-routing-route-label";

/** Class of the dot marking the step being pointed at. Part of the same contract. */
const STEP_DOT_CLASS = "maptiler-routing-step-dot";

/** What a waypoint is to the route it belongs to, which picks its marker options. */
type WaypointRole = "origin" | "destination" | "via";

/** A waypoint's role, from its place in the list. */
function waypointRole(index: number, count: number): WaypointRole {
  if (index === 0) return "origin";
  if (index === count - 1) return "destination";
  return "via";
}

/** Reflects a state on a badge, which the stylesheet colours from. */
function setLabelFlag(element: HTMLElement, name: "data-selected" | "data-hovered", on: boolean): void {
  if (on) element.setAttribute(name, "");
  else element.removeAttribute(name);
}

/** Callbacks the renderer raises for interactions on the map. */
export type RouteRendererHandlers = {
  /** A route line was clicked. `index` is the route's position in the drawn list. */
  onRouteClick: (index: number) => void;
  /** A waypoint marker finished being dragged. */
  onWaypointDragEnd: (id: string, lngLat: [number, number]) => void;
};

/**
 * Draws routes and waypoint markers on a map.
 *
 * Owns every map-attached object the routing module creates — one GeoJSON
 * source, up to three line layers and one marker per located waypoint — and
 * puts them back after a style change.
 *
 * Internal: consumers reach this through {@link RoutingController}.
 */
export class RouteRenderer {
  private readonly map: SDKMap;
  private readonly handlers: RouteRendererHandlers;
  private render: ResolvedRenderOptions;
  private waypointMarkerOptions: ResolvedWaypointMarkerOptions;
  private readonly routeLabelOptions: ResolvedRouteLabelOptions;

  /** The collection currently shown, kept so a style change can restore it. */
  private data: FeatureCollection<LineString, RouteFeatureProperties> = EMPTY_ROUTE_COLLECTION;

  /**
   * Waypoint markers, keyed by waypoint id. Owned and disposed explicitly.
   *
   * The role is kept with the marker because `MarkerOptions` are read once, at
   * construction: a marker whose role changed has to be rebuilt, and this is
   * what says whether it did.
   */
  private readonly markers = new Map<string, { marker: Marker; role: WaypointRole }>();

  /** The dot marking the step the user is pointing at, while there is one. */
  private stepMarker: Marker | null = null;

  /** Travel-time badges, keyed by the index of the route they belong to. */
  private readonly labels = new Map<number, { marker: Marker; element: HTMLElement }>();

  /** `true` once the interaction listeners have been registered. */
  private attached = false;

  /** Ids the current render configuration adds, for {@link reapply}'s guard. */
  private expectedLayerIds: string[];

  /** Index of the route under the pointer, or `null` when the pointer is off them. */
  private hoveredIndex: number | null = null;

  private destroyed = false;

  constructor(map: SDKMap, render: ResolvedRenderOptions, waypointMarkers: ResolvedWaypointMarkerOptions, routeLabels: ResolvedRouteLabelOptions, handlers: RouteRendererHandlers) {
    this.map = map;
    this.render = render;
    this.waypointMarkerOptions = waypointMarkers;
    this.routeLabelOptions = routeLabels;
    this.handlers = handlers;
    this.expectedLayerIds = buildRouteLayers(render).map((layer) => layer.id);

    // MapLibre drops every source and layer on a style swap, so both events
    // are hooked: `style.load` covers a completed swap, `styledata` covers the
    // intermediate states it fires during one. Re-attaching is idempotent.
    this.map.on("styledata", this.reapply);
    this.map.on("style.load", this.reapply);
  }

  //#region Attachment

  /**
   * Adds the source and layers, and pushes the current data back into them.
   *
   * Safe to call at any time: every step checks for what is already there, so
   * a style change that fires several `styledata` events costs one attachment.
   */
  private attach(): void {
    if (this.destroyed || !this.render.enabled) return;

    try {
      if (!this.map.getSource(ROUTE_SOURCE_ID)) {
        this.map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: this.data });
      }

      // resolved per attachment: the new style has different layers, so an id
      // remembered from the previous one would be stale
      const beforeId = this.resolveBeforeId();

      for (const layer of buildRouteLayers(this.render)) {
        if (this.map.getLayer(layer.id)) continue;
        // MapLibre throws when `beforeId` names a layer that does not exist
        if (beforeId) this.map.addLayer(layer, beforeId);
        else this.map.addLayer(layer);
      }
    } catch {
      // A route computed before the style has finished parsing lands here:
      // MapLibre answers "Style is not done loading". The data is kept, so the
      // next `styledata` draws it — which is the same path a style swap takes.
      // Swallowed rather than propagated: this runs inside the routing
      // promise, and a drawing hiccup is not a failed request.
      // `once` is typed as returning a promise when it is called without a
      // handler; with one it returns the map, so there is nothing to await
      void this.map.once("styledata", this.reapply);
      return;
    }

    if (!this.attached) {
      this.map.on("click", ROUTE_HITBOX_LAYER_ID, this.handleRouteClick);
      this.map.on("mouseenter", ROUTE_HITBOX_LAYER_ID, this.handleRouteEnter);
      this.map.on("mousemove", ROUTE_HITBOX_LAYER_ID, this.handleRouteMove);
      this.map.on("mouseleave", ROUTE_HITBOX_LAYER_ID, this.handleRouteLeave);
      this.attached = true;
    }

    this.setSourceData();
  }

  /** Where the route layers are inserted: the consumer's choice, else under the first labels. */
  private resolveBeforeId(): string | undefined {
    if (this.render.beforeId === null) return undefined;
    if (this.render.beforeId !== undefined) {
      return this.map.getLayer(this.render.beforeId) ? this.render.beforeId : undefined;
    }

    // typed as always present, but absent until the style has parsed
    const style = this.map.getStyle() as StyleSpecification | undefined;
    return style ? firstSymbolLayerId(style.layers) : undefined;
  }

  /**
   * Puts the layers back after a style change.
   *
   * Early-outs on the cheapest possible check, because `styledata` fires many
   * times per style load. The ids checked are the ones this render configuration
   * actually adds, not every id the module can add: the casing layer is omitted
   * when it is switched off, and demanding it would make the check unsatisfiable
   * and every event pay for a full re-attach.
   */
  private reapply = (): void => {
    if (this.destroyed) return;
    // not `attached`: the first draw may have been the one that had to wait
    // for the style, in which case nothing has ever been attached. Both the
    // source and the layers are checked, since an attach interrupted by a
    // style still parsing can leave one without the other.
    if (this.map.getSource(ROUTE_SOURCE_ID) && this.expectedLayerIds.every((id) => this.map.getLayer(id))) return;
    this.attach();
  };

  private setSourceData(): void {
    const source = this.map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(this.data);
  }

  //#endregion

  //#region Routes

  /**
   * Draws the given routes, with one of them selected.
   *
   * @param routes - Routes to draw, best route first.
   * @param selectedIndex - Index of the selected route.
   */
  setRoutes(routes: Route[], selectedIndex: number): void {
    if (this.destroyed || !this.render.enabled) return;

    // whatever the pointer was over is gone, and a stale index would highlight
    // a line the user never touched
    this.clearHoverState();
    this.data = buildRouteFeatureCollection(routes, selectedIndex);
    this.attach();
    this.setSourceData();
    this.setRouteLabels(routes, selectedIndex);
  }

  /** Removes every drawn route, keeping the source and layers in place. */
  clearRoutes(): void {
    if (this.destroyed) return;

    this.clearHoverState();
    this.setStepMarker(null);
    this.data = EMPTY_ROUTE_COLLECTION;
    this.setSourceData();
    this.clearRouteLabels();
  }

  /**
   * Replaces the paint options and redraws with them.
   *
   * `attached` is deliberately left alone: it tracks the interaction listeners,
   * which are bound to a layer id rather than to a layer object and so keep
   * working across the removal and re-adding below. Clearing it here made
   * {@link attach} register a second set of the four every call, and one click
   * on a line select the route once per set.
   */
  setRenderOptions(render: ResolvedRenderOptions): void {
    this.render = render;
    this.expectedLayerIds = buildRouteLayers(render).map((layer) => layer.id);
    this.clearHoverState();
    this.detachLayers();
    this.attach();
  }

  //#endregion

  /**
   * Puts a dot on the map at the given point, or takes it away.
   *
   * One marker, moved rather than rebuilt: pointing down a list of turns is a
   * fast gesture, and rebuilding the element on every row would flicker.
   */
  setStepMarker(lngLat: [number, number] | null): void {
    if (this.destroyed) return;

    if (!lngLat) {
      this.stepMarker?.remove();
      this.stepMarker = null;
      return;
    }

    if (!this.stepMarker) {
      const element = document.createElement("div");
      element.className = STEP_DOT_CLASS;
      this.stepMarker = new Marker({ element, anchor: "center" });
    }

    this.stepMarker.setLngLat(lngLat).addTo(this.map);
  }

  //#region Route labels

  /**
   * Draws one travel-time badge per route, halfway along its line.
   *
   * Badges are reused by index across renders — a selection change only
   * rewrites the text and the state attribute, so nothing flickers and the
   * markers are not torn down and rebuilt on every pass.
   */
  private setRouteLabels(routes: Route[], selectedIndex: number): void {
    if (!this.routeLabelOptions.enabled) {
      this.clearRouteLabels();
      return;
    }

    const drawn = new Set<number>();

    routes.forEach((route, index) => {
      const midpoint = getLineMidpoint(getRouteCoordinates(route));
      const text = this.routeLabelOptions.format(route, index, index === selectedIndex);

      // no midpoint means no usable geometry, and an empty label is how a
      // consumer opts one badge out
      if (!midpoint || text === "") return;

      drawn.add(index);
      const existing = this.labels.get(index);
      const entry = existing ?? this.createRouteLabel(index);

      entry.element.textContent = text;
      setLabelFlag(entry.element, "data-selected", index === selectedIndex);
      setLabelFlag(entry.element, "data-hovered", index === this.hoveredIndex);
      entry.marker.setLngLat(midpoint);

      if (!existing) {
        entry.marker.addTo(this.map);
        this.labels.set(index, entry);
      }
    });

    // drop badges for routes that are no longer drawn
    for (const [index, entry] of this.labels) {
      if (drawn.has(index)) continue;
      entry.marker.remove();
      this.labels.delete(index);
    }
  }

  private createRouteLabel(index: number): { marker: Marker; element: HTMLElement } {
    const element = document.createElement("div");
    element.className = ROUTE_LABEL_CLASS;
    element.dataset.index = index.toString();

    // the badge covers the line it labels, so the pointer reaching it would
    // otherwise read as leaving the route: both carry the hover between them
    element.addEventListener("mouseenter", () => {
      this.setHovered(index);
    });
    element.addEventListener("mouseleave", () => {
      this.setHovered(null);
    });

    if (this.routeLabelOptions.selectOnClick) {
      element.addEventListener("click", (event) => {
        // the badge sits over the line; without this the map click handler
        // would also see it and, in a routing UI, append a waypoint
        event.stopPropagation();
        this.handlers.onRouteClick(index);
      });
    }

    return { marker: new Marker({ element, anchor: "center" }), element };
  }

  /** Puts the hover state on one badge, or takes it off. Silent when it has none. */
  private setLabelHovered(index: number | null, hovered: boolean): void {
    if (index === null) return;
    const entry = this.labels.get(index);
    if (entry) setLabelFlag(entry.element, "data-hovered", hovered);
  }

  private clearRouteLabels(): void {
    for (const entry of this.labels.values()) entry.marker.remove();
    this.labels.clear();
  }

  //#endregion

  //#region Waypoint markers

  /**
   * Syncs the waypoint markers with the waypoint list.
   *
   * Markers are reused by waypoint id, so dragging one does not rebuild it and
   * a re-render never interrupts an in-flight drag.
   */
  setWaypoints(waypoints: RoutingWaypoint[]): void {
    if (this.destroyed) return;

    if (!this.waypointMarkerOptions.enabled) {
      this.clearMarkers();
      return;
    }

    const seen = new Set<string>();

    waypoints.forEach((waypoint, index) => {
      if (!waypoint.lngLat) return;
      seen.add(waypoint.id);

      const role = waypointRole(index, waypoints.length);
      const existing = this.markers.get(waypoint.id);

      // reordering moves a waypoint between roles, and the options that draw
      // one were read at construction: kept, the marker would carry the start
      // pin down to a stop in the middle
      if (existing && existing.role === role) {
        const current = existing.marker.getLngLat();
        if (current.lng !== waypoint.lngLat[0] || current.lat !== waypoint.lngLat[1]) {
          existing.marker.setLngLat(waypoint.lngLat);
        }
        return;
      }

      existing?.marker.remove();

      const marker = new Marker(this.markerOptionsFor(role)).setLngLat(waypoint.lngLat).addTo(this.map);

      marker.on("dragend", () => {
        const { lng, lat } = marker.getLngLat();
        this.handlers.onWaypointDragEnd(waypoint.id, [lng, lat]);
      });

      this.markers.set(waypoint.id, { marker, role });
    });

    for (const [id, entry] of this.markers) {
      if (seen.has(id)) continue;
      entry.marker.remove();
      this.markers.delete(id);
    }
  }

  /** Marker options for a waypoint: the base options, then the role-specific ones. */
  private markerOptionsFor(role: WaypointRole): MarkerOptions {
    const roleOptions = role === "origin" ? this.waypointMarkerOptions.origin : role === "destination" ? this.waypointMarkerOptions.destination : {};

    return {
      draggable: this.waypointMarkerOptions.draggable,
      ...this.waypointMarkerOptions.marker,
      ...roleOptions,
    };
  }

  private clearMarkers(): void {
    for (const { marker } of this.markers.values()) marker.remove();
    this.markers.clear();
  }

  //#endregion

  //#region Interaction

  private handleRouteClick = (event: MapMouseEvent & { features?: { properties?: Record<string, unknown> }[] }): void => {
    const index = event.features?.[0]?.properties?.index;
    if (typeof index === "number") this.handlers.onRouteClick(index);
  };

  private handleRouteEnter = (): void => {
    this.map.getCanvas().style.cursor = "pointer";
  };

  private handleRouteLeave = (): void => {
    this.map.getCanvas().style.cursor = "";
    this.setHovered(null);
  };

  /**
   * Follows the pointer along the lines.
   *
   * `mousemove` rather than `mouseenter`: where two routes run together the
   * pointer crosses from one to the other without ever leaving the layer, and
   * the enter event fires once for the layer rather than once per feature.
   */
  private handleRouteMove = (event: MapMouseEvent & { features?: { id?: number | string }[] }): void => {
    const id = event.features?.[0]?.id;
    this.setHovered(typeof id === "number" ? id : null);
  };

  /**
   * Moves the `hover` feature state from the line that had it to the given one.
   *
   * The state lives on the source rather than in the data, so it survives a
   * selection change and costs no re-parse of the geometry. It survives new
   * data too, which is what {@link clearHoverState} is for.
   */
  private setHovered(index: number | null): void {
    if (this.hoveredIndex === index) return;
    // mid style swap the source is briefly gone, and MapLibre throws on a
    // feature state set against a source it cannot find. The state went with
    // the source, but the badge is ours and still needs resetting.
    if (!this.map.getSource(ROUTE_SOURCE_ID)) {
      this.clearHoverState();
      return;
    }

    // a route drawn under the pointer is not one the pointer moved onto, and
    // the drawn state is the selected one either way
    if (this.hoveredIndex !== null) this.map.removeFeatureState({ source: ROUTE_SOURCE_ID, id: this.hoveredIndex }, "hover");
    if (index !== null) this.map.setFeatureState({ source: ROUTE_SOURCE_ID, id: index }, { hover: true });

    this.setLabelHovered(this.hoveredIndex, false);
    this.setLabelHovered(index, true);
    this.hoveredIndex = index;
  }

  /**
   * Forgets which line was hovered, taking the paint with it.
   *
   * MapLibre keeps feature state in the source cache across a `setData`, and
   * the ids are route indices the next result set reuses: dropped without being
   * removed, the state would paint whichever route lands on that index as
   * hovered, with the pointer nowhere near it and the badge — recomputed from
   * `hoveredIndex` — disagreeing. It would not clear either, since
   * {@link setHovered} early-outs when the index it is given already matches.
   */
  private clearHoverState(): void {
    if (this.hoveredIndex === null) return;

    // the state is already gone with a source that is gone, and MapLibre throws
    // on a feature state call against one it cannot find
    if (this.map.getSource(ROUTE_SOURCE_ID)) {
      this.map.removeFeatureState({ source: ROUTE_SOURCE_ID, id: this.hoveredIndex }, "hover");
    }

    this.setLabelHovered(this.hoveredIndex, false);
    this.hoveredIndex = null;
  }

  //#endregion

  //#region Teardown

  private detachLayers(): void {
    for (const id of ROUTE_LAYER_IDS) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    if (this.map.getSource(ROUTE_SOURCE_ID)) this.map.removeSource(ROUTE_SOURCE_ID);
  }

  /** Removes everything this renderer added to the map and stops listening. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.map.off("styledata", this.reapply);
    this.map.off("style.load", this.reapply);

    if (this.attached) {
      this.map.off("click", ROUTE_HITBOX_LAYER_ID, this.handleRouteClick);
      this.map.off("mouseenter", ROUTE_HITBOX_LAYER_ID, this.handleRouteEnter);
      this.map.off("mousemove", ROUTE_HITBOX_LAYER_ID, this.handleRouteMove);
      this.map.off("mouseleave", ROUTE_HITBOX_LAYER_ID, this.handleRouteLeave);
    }

    this.clearMarkers();
    this.clearRouteLabels();
    this.stepMarker?.remove();
    this.stepMarker = null;

    // the style may already be gone when the map itself is being removed
    try {
      this.detachLayers();
    } catch {
      // nothing to detach from
    }
  }

  //#endregion
}
