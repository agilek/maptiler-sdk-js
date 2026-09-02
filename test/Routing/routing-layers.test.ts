import { describe, expect, it } from "vitest";
import type { LayerSpecification } from "maplibre-gl";
import { buildCasingLayer, buildHitboxLayer, buildLineLayer, buildRouteFeatureCollection, buildRouteLayers, firstSymbolLayerId } from "../../src/Routing/routing-layers";
import { resolveRoutingOptions } from "../../src/Routing/routing-constants";
import { makeRoute, makeSummary } from "./fixtures";

const render = resolveRoutingOptions().render;

const line: [number, number][] = [
  [0, 0],
  [1, 1],
  [2, 2],
];

//#region firstSymbolLayerId

describe("firstSymbolLayerId", () => {
  const layers = [
    { id: "bg", type: "background" },
    { id: "water", type: "fill" },
    { id: "labels", type: "symbol" },
    { id: "more-labels", type: "symbol" },
  ] as LayerSpecification[];

  it("returns the id of the first symbol layer", () => {
    expect(firstSymbolLayerId(layers)).toBe("labels");
  });

  it("returns undefined when the style has no symbol layer", () => {
    expect(firstSymbolLayerId(layers.filter((layer) => layer.type !== "symbol"))).toBeUndefined();
  });

  it("returns undefined for an empty style", () => {
    expect(firstSymbolLayerId([])).toBeUndefined();
  });

  it("skips an early symbol layer that has more line layers drawn after it", () => {
    // Mirrors MapTiler Outdoor: contour labels (symbol) sit among the
    // terrain lines, then trail overlays (line) resume on top of them. The
    // first symbol layer there is a trap — anchoring on it would sink the
    // route under those later trails.
    const interleaved = [
      { id: "bg", type: "background" },
      { id: "hillshade", type: "hillshade" },
      { id: "contour", type: "line" },
      { id: "contour-labels", type: "symbol" },
      { id: "trail", type: "line" },
      { id: "place-labels", type: "symbol" },
    ] as LayerSpecification[];

    expect(firstSymbolLayerId(interleaved)).toBe("place-labels");
  });
});

//#endregion

//#region buildRouteFeatureCollection

describe("buildRouteFeatureCollection", () => {
  it("produces one LineString feature per route", () => {
    const collection = buildRouteFeatureCollection([makeRoute([line]), makeRoute([line]), makeRoute([line])], 0);

    expect(collection.features).toHaveLength(3);
    expect(collection.features[0].geometry.type).toBe("LineString");
  });

  it("marks exactly one feature as selected", () => {
    const collection = buildRouteFeatureCollection([makeRoute([line]), makeRoute([line])], 1);
    const selected = collection.features.filter((feature) => feature.properties.selected);

    expect(selected).toHaveLength(1);
    expect(selected[0].properties.index).toBe(1);
  });

  it("gives the selected feature a higher sort key, so it draws on top", () => {
    const collection = buildRouteFeatureCollection([makeRoute([line]), makeRoute([line])], 1);

    expect(collection.features[0].properties.sortKey).toBe(0);
    expect(collection.features[1].properties.sortKey).toBe(1);
  });

  it("carries the summary figures a consumer may want to label with", () => {
    const collection = buildRouteFeatureCollection([makeRoute([line])], 0);

    expect(collection.features[0].properties).toMatchObject({ totalTime: 3600, totalLength: 100 });
  });

  it("returns an empty collection rather than null when there are no routes", () => {
    expect(buildRouteFeatureCollection([], 0)).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("skips a route whose geometry is too short to be a valid LineString", () => {
    const degenerate = { summary: makeSummary(), legs: [{ summary: makeSummary(), geometry: [[8, 47]] as [number, number][] }] };

    expect(buildRouteFeatureCollection([degenerate], 0).features).toHaveLength(0);
  });

  it("gives each feature its route index as an id, which feature state is addressed by", () => {
    const collection = buildRouteFeatureCollection([makeRoute([line]), makeRoute([line])], 0);

    expect(collection.features.map((feature) => feature.id)).toEqual([0, 1]);
  });

  it("marks nothing as selected when the index is out of range", () => {
    const collection = buildRouteFeatureCollection([makeRoute([line])], -1);

    expect(collection.features[0].properties.selected).toBe(false);
  });
});

//#endregion

//#region Layer specifications

describe("buildLineLayer", () => {
  it("gives the alternate under the pointer its own paint, between the two", () => {
    const paint = buildLineLayer(render).paint;
    const hovered = ["boolean", ["feature-state", "hover"], false];

    expect(paint?.["line-color"]).toEqual(["case", ["get", "selected"], render.selected.color, hovered, render.hover.color, render.alternate.color]);
    expect(paint?.["line-width"]).toEqual(["case", ["get", "selected"], render.selected.width, hovered, render.hover.width, render.alternate.width]);
    expect(paint?.["line-opacity"]).toEqual(["case", ["get", "selected"], render.selected.opacity, hovered, render.hover.opacity, render.alternate.opacity]);
  });

  it("drops the hover branch when hovering is off, rather than painting it the alternate colour", () => {
    const withoutHover = resolveRoutingOptions({ render: { hover: { enabled: false } } }).render;
    const paint = buildLineLayer(withoutHover).paint;

    expect(paint?.["line-color"]).toEqual(["case", ["get", "selected"], withoutHover.selected.color, withoutHover.alternate.color]);
    expect(paint?.["line-width"]).toEqual(["case", ["get", "selected"], withoutHover.selected.width, withoutHover.alternate.width]);
  });

  it("sorts features by the sort key", () => {
    expect(buildLineLayer(render).layout?.["line-sort-key"]).toEqual(["get", "sortKey"]);
  });
});

describe("buildCasingLayer", () => {
  it("draws a flat color wider than the route line", () => {
    const paint = buildCasingLayer(render).paint;

    expect(paint?.["line-color"]).toBe(render.casing.color);
    expect(render.casing.width).toBeGreaterThan(render.selected.width);
  });

  it("cases every route the same while the alternates are drawn at the selected width", () => {
    expect(buildCasingLayer(render).paint?.["line-width"]).toEqual([
      "case",
      ["get", "selected"],
      render.casing.width,
      ["boolean", ["feature-state", "hover"], false],
      render.casing.width,
      render.casing.width,
    ]);
  });

  it("narrows the alternate casing by whatever the alternate line gives up", () => {
    const thinner = resolveRoutingOptions({ render: { alternate: { width: 2 } } }).render;

    // 4px thinner a line, 4px thinner its casing: the margin either side of it
    // is the same as under the selected route
    expect(buildCasingLayer(thinner).paint?.["line-width"]).toEqual([
      "case",
      ["get", "selected"],
      thinner.casing.width,
      ["boolean", ["feature-state", "hover"], false],
      thinner.casing.width,
      thinner.casing.width - 4,
    ]);
  });
});

describe("buildHitboxLayer", () => {
  it("is transparent but stays visible, so queryRenderedFeatures still sees it", () => {
    const layer = buildHitboxLayer(render);

    expect(layer.paint?.["line-opacity"]).toBe(0);
    expect(layer.layout?.visibility).toBe("visible");
  });

  it("is wider than the drawn line, so thin alternates stay clickable", () => {
    expect(buildHitboxLayer(render).paint?.["line-width"]).toBeGreaterThan(render.alternate.width);
  });
});

describe("buildRouteLayers", () => {
  it("orders the layers casing, line, hitbox", () => {
    expect(buildRouteLayers(render).map((layer) => layer.id)).toEqual(["maptiler-routing-route-casing", "maptiler-routing-route-line", "maptiler-routing-route-hitbox"]);
  });

  it("omits the casing when it is disabled", () => {
    const withoutCasing = resolveRoutingOptions({ render: { casing: { enabled: false } } }).render;

    expect(buildRouteLayers(withoutCasing).map((layer) => layer.id)).toEqual(["maptiler-routing-route-line", "maptiler-routing-route-hitbox"]);
  });
});

//#endregion
