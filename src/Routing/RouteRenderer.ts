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

/** Reflects selection on a badge, which the stylesheet colours from. */
function setLabelSelected(element: HTMLElement, selected: boolean): void {
  if (selected) element.setAttribute("data-selected", "");
  else element.removeAttribute("data-selected");
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

  /** Waypoint markers, keyed by waypoint id. Owned and disposed explicitly. */
  private readonly markers = new Map<string, Marker>();

  /** Travel-time badges, keyed by the index of the route they belong to. */
  private readonly labels = new Map<number, { marker: Marker; element: HTMLElement }>();

  /** `true` once the source and layers have been added at least once. */
  private attached = false;

  private destroyed = false;

  constructor(map: SDKMap, render: ResolvedRenderOptions, waypointMarkers: ResolvedWaypointMarkerOptions, routeLabels: ResolvedRouteLabelOptions, handlers: RouteRendererHandlers) {
    this.map = map;
    this.render = render;
    this.waypointMarkerOptions = waypointMarkers;
    this.routeLabelOptions = routeLabels;
    this.handlers = handlers;

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

    if (!this.attached) {
      this.map.on("click", ROUTE_HITBOX_LAYER_ID, this.handleRouteClick);
      this.map.on("mouseenter", ROUTE_HITBOX_LAYER_ID, this.handleRouteEnter);
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
   * times per style load.
   */
  private reapply = (): void => {
    if (this.destroyed || !this.attached) return;
    if (this.map.getSource(ROUTE_SOURCE_ID)) return;
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

    this.data = buildRouteFeatureCollection(routes, selectedIndex);
    this.attach();
    this.setSourceData();
    this.setRouteLabels(routes, selectedIndex);
  }

  /** Removes every drawn route, keeping the source and layers in place. */
  clearRoutes(): void {
    if (this.destroyed) return;

    this.data = EMPTY_ROUTE_COLLECTION;
    this.setSourceData();
    this.clearRouteLabels();
  }

  /** Replaces the paint options and redraws with them. */
  setRenderOptions(render: ResolvedRenderOptions): void {
    this.render = render;
    this.detachLayers();
    this.attached = false;
    this.attach();
  }

  //#endregion

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
      setLabelSelected(entry.element, index === selectedIndex);
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

      const existing = this.markers.get(waypoint.id);
      if (existing) {
        const current = existing.getLngLat();
        if (current.lng !== waypoint.lngLat[0] || current.lat !== waypoint.lngLat[1]) {
          existing.setLngLat(waypoint.lngLat);
        }
        return;
      }

      const marker = new Marker(this.markerOptionsFor(index, waypoints.length)).setLngLat(waypoint.lngLat).addTo(this.map);

      marker.on("dragend", () => {
        const { lng, lat } = marker.getLngLat();
        this.handlers.onWaypointDragEnd(waypoint.id, [lng, lat]);
      });

      this.markers.set(waypoint.id, marker);
    });

    for (const [id, marker] of this.markers) {
      if (seen.has(id)) continue;
      marker.remove();
      this.markers.delete(id);
    }
  }

  /** Marker options for a waypoint: the base options, then the role-specific ones. */
  private markerOptionsFor(index: number, count: number): MarkerOptions {
    const role = index === 0 ? this.waypointMarkerOptions.origin : index === count - 1 ? this.waypointMarkerOptions.destination : {};

    return {
      draggable: this.waypointMarkerOptions.draggable,
      ...this.waypointMarkerOptions.marker,
      ...role,
    };
  }

  private clearMarkers(): void {
    for (const marker of this.markers.values()) marker.remove();
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
  };

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
      this.map.off("mouseleave", ROUTE_HITBOX_LAYER_ID, this.handleRouteLeave);
    }

    this.clearMarkers();
    this.clearRouteLabels();

    // the style may already be gone when the map itself is being removed
    try {
      this.detachLayers();
    } catch {
      // nothing to detach from
    }
  }

  //#endregion
}
