import type { Feature, FeatureCollection, LineString } from "geojson";
import type { ExpressionSpecification, LayerSpecification, LineLayerSpecification } from "maplibre-gl";
import { ROUTE_CASING_LAYER_ID, ROUTE_HITBOX_LAYER_ID, ROUTE_LINE_LAYER_ID, ROUTE_SOURCE_ID, type ResolvedRenderOptions } from "./routing-constants";
import { getRouteCoordinates } from "./routing-geometry";
import type { Route, RouteLineStyle } from "./types";

/** Properties carried by each route feature, read by the paint expressions and the click handler. */
export type RouteFeatureProperties = {
  /** Index of the route within the controller's route list. */
  index: number;
  /** `true` for the selected route. Drives both paint and draw order. */
  selected: boolean;
  /** `1` when selected, `0` otherwise. Fed to `line-sort-key`. */
  sortKey: number;
  /** Travel time in seconds, so a consumer can label the line from the source. */
  totalTime: number;
  /** Length in the response units. */
  totalLength: number;
};

/** An empty collection — the source is always given a collection, never `null`. */
export const EMPTY_ROUTE_COLLECTION: FeatureCollection<LineString, RouteFeatureProperties> = {
  type: "FeatureCollection",
  features: [],
};

/**
 * Id of the style's first `symbol` layer.
 *
 * @param layers - The style's layers, in order.
 * @returns The id, or `undefined` when the style has no symbol layer.
 *
 * @remarks
 * This is the default insertion point for the route layers, so a route is
 * drawn under the labels rather than over them.
 */
export function firstSymbolLayerId(layers: readonly LayerSpecification[]): string | undefined {
  return layers.find((layer) => layer.type === "symbol")?.id;
}

/**
 * Builds one `LineString` feature per route.
 *
 * @param routes - The routes to draw, best route first.
 * @param selectedIndex - Index of the selected route.
 * @returns The collection to hand to the GeoJSON source.
 *
 * @remarks
 * A route whose geometry decodes to fewer than two coordinates is skipped: it
 * would be an invalid `LineString`, which MapLibre reports as a style error.
 */
export function buildRouteFeatureCollection(routes: Route[], selectedIndex: number): FeatureCollection<LineString, RouteFeatureProperties> {
  const features: Feature<LineString, RouteFeatureProperties>[] = [];

  routes.forEach((route, index) => {
    const coordinates = getRouteCoordinates(route);
    if (coordinates.length < 2) return;

    const selected = index === selectedIndex;

    features.push({
      type: "Feature",
      // the route's own index, which is what lets the renderer set a hover
      // state on one line: `setFeatureState` addresses a feature by id, and a
      // GeoJSON source has none to give unless the data carries one
      id: index,
      geometry: { type: "LineString", coordinates },
      properties: {
        index,
        selected,
        sortKey: selected ? 1 : 0,
        totalTime: route.summary.totalTime,
        totalLength: route.summary.totalLength,
      },
    });
  });

  return { type: "FeatureCollection", features };
}

/** The feature-state test the hover branches share. */
const HOVERED: ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];

/**
 * The casing under an alternate.
 *
 * Derived rather than fixed: what should stay the same between the two is the
 * margin of casing showing either side of the line, so the alternate's casing
 * gives up exactly what its line gives up. With alternates drawn at the
 * selected route's width — the default — the two casings match.
 */
function alternateCasingWidth(render: ResolvedRenderOptions): number {
  return Math.max(render.casing.width - Math.max(render.selected.width - render.alternate.width, 0), 1);
}

/** Layout shared by all three line layers. Selected routes sort above the alternates. */
function lineLayout(): LineLayerSpecification["layout"] {
  return {
    "line-cap": "round",
    "line-join": "round",
    "line-sort-key": ["get", "sortKey"],
    visibility: "visible",
  };
}

/**
 * Picks between three values: the selected route's, the hovered alternate's,
 * and every other alternate's.
 *
 * Selection is a property and hover is a feature state, which is the difference
 * between the two: the first is in the data the source was given, the second is
 * set on a feature by id as the pointer moves, without touching the data.
 *
 * The hover branch is dropped entirely when hovering is off, so the expression
 * a consumer reads back from the style says what it actually does.
 */
function byRouteState(render: ResolvedRenderOptions, key: keyof RouteLineStyle): ExpressionSpecification {
  const selected = render.selected[key];
  const alternate = render.alternate[key];
  if (!render.hover.enabled) return ["case", ["get", "selected"], selected, alternate] as ExpressionSpecification;

  return ["case", ["get", "selected"], selected, HOVERED, render.hover[key], alternate] as ExpressionSpecification;
}

/**
 * The casing layer specification — a wider, flat-colored line beneath the
 * route, which is what separates the route visually from the map beneath it.
 */
export function buildCasingLayer(render: ResolvedRenderOptions): LineLayerSpecification {
  return {
    id: ROUTE_CASING_LAYER_ID,
    type: "line",
    source: ROUTE_SOURCE_ID,
    layout: lineLayout(),
    paint: {
      "line-color": render.casing.color,
      "line-opacity": render.casing.opacity,
      // the casing follows the line it sits under: full width for the selected
      // route and for a hovered alternate, narrower for the rest
      "line-width": (render.hover.enabled
        ? ["case", ["get", "selected"], render.casing.width, HOVERED, render.casing.width, alternateCasingWidth(render)]
        : ["case", ["get", "selected"], render.casing.width, alternateCasingWidth(render)]) as ExpressionSpecification,
    },
  };
}

/** The visible route line layer: one paint, switched per feature on `selected`. */
export function buildLineLayer(render: ResolvedRenderOptions): LineLayerSpecification {
  return {
    id: ROUTE_LINE_LAYER_ID,
    type: "line",
    source: ROUTE_SOURCE_ID,
    layout: lineLayout(),
    paint: {
      "line-color": byRouteState(render, "color"),
      "line-opacity": byRouteState(render, "opacity"),
      "line-width": byRouteState(render, "width"),
    },
  };
}

/**
 * The hit-test layer: fully transparent but wider than the drawn line, so a
 * thin alternate stays easy to click.
 *
 * @remarks
 * Its `visibility` must stay `"visible"`. A layer hidden through `layout` is
 * not returned by `queryRenderedFeatures`, so hiding it would silently break
 * route selection; transparency is what makes it invisible.
 */
export function buildHitboxLayer(render: ResolvedRenderOptions): LineLayerSpecification {
  return {
    id: ROUTE_HITBOX_LAYER_ID,
    type: "line",
    source: ROUTE_SOURCE_ID,
    layout: lineLayout(),
    paint: {
      "line-color": "#000000",
      "line-opacity": 0,
      "line-width": render.hitTestWidth,
    },
  };
}

/** Every layer this module adds, in the order they must be added (bottom first). */
export function buildRouteLayers(render: ResolvedRenderOptions): LineLayerSpecification[] {
  const layers = [buildLineLayer(render), buildHitboxLayer(render)];
  return render.casing.enabled ? [buildCasingLayer(render), ...layers] : layers;
}
