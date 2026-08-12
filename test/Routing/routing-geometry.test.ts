import { describe, expect, it } from "vitest";
import { getCoordinatesBounds, getLegCoordinates, getLineMidpoint, getRouteCoordinates, getRoutesBounds } from "../../src/Routing/routing-geometry";
import type { Route } from "../../src/Routing/types";
import { makeLeg, makeRoute, makeSummary } from "./fixtures";

//#region getLegCoordinates

describe("getLegCoordinates", () => {
  it("decodes an encoded geometry", () => {
    const leg = makeLeg([
      [8.54, 47.37],
      [8.55, 47.38],
    ]);

    const coordinates = getLegCoordinates(leg);

    expect(coordinates).toHaveLength(2);
    expect(coordinates[0][0]).toBeCloseTo(8.54, 6);
  });

  it("passes through a raw coordinate array", () => {
    const raw: [number, number][] = [
      [8.54, 47.37],
      [8.55, 47.38],
    ];

    expect(getLegCoordinates({ summary: makeSummary(), geometry: raw })).toEqual(raw);
  });

  it("returns an empty array for a missing geometry", () => {
    expect(getLegCoordinates({ summary: makeSummary(), geometry: "" })).toEqual([]);
  });
});

//#endregion

//#region getRouteCoordinates

describe("getRouteCoordinates", () => {
  const legA: [number, number][] = [
    [0, 0],
    [1, 1],
    [2, 2],
  ];
  const legB: [number, number][] = [
    [2, 2],
    [3, 3],
  ];
  const legC: [number, number][] = [
    [3, 3],
    [4, 4],
  ];

  it("returns a single leg unchanged", () => {
    expect(getRouteCoordinates(makeRoute([legA]))).toHaveLength(3);
  });

  it("drops exactly one seam coordinate when joining two legs", () => {
    // 3 + 2 coordinates, minus the point both legs share
    expect(getRouteCoordinates(makeRoute([legA, legB]))).toHaveLength(4);
  });

  it("drops one seam coordinate per join for three legs", () => {
    expect(getRouteCoordinates(makeRoute([legA, legB, legC]))).toHaveLength(5);
  });

  it("keeps the joined line in travel order", () => {
    const joined = getRouteCoordinates(makeRoute([legA, legB]));

    expect(joined[0][0]).toBeCloseTo(0, 6);
    expect(joined[joined.length - 1][0]).toBeCloseTo(3, 6);
  });

  it("returns an empty array for a route with no legs", () => {
    expect(getRouteCoordinates({ summary: makeSummary(), legs: [] })).toEqual([]);
  });
});

//#endregion

//#region getRoutesBounds

describe("getRoutesBounds", () => {
  const routeWith = (bbox: [number, number, number, number]): Route => ({ summary: makeSummary({ bbox }), legs: [] });

  it("unions the bounding boxes of several routes", () => {
    const bounds = getRoutesBounds([routeWith([8, 47, 10, 49]), routeWith([9, 46, 13, 51]), routeWith([7, 48, 11, 50])]);

    expect(bounds).toEqual([
      [7, 46],
      [13, 51],
    ]);
  });

  it("returns the single route's box unchanged", () => {
    expect(getRoutesBounds([routeWith([8, 47, 10, 49])])).toEqual([
      [8, 47],
      [10, 49],
    ]);
  });

  it("returns null when there are no routes", () => {
    expect(getRoutesBounds([])).toBeNull();
  });

  it("ignores a route whose bounding box is missing or malformed", () => {
    const malformed = { summary: { ...makeSummary(), bbox: undefined } } as unknown as Route;

    expect(getRoutesBounds([malformed, routeWith([8, 47, 10, 49])])).toEqual([
      [8, 47],
      [10, 49],
    ]);
  });

  it("returns null when every route's bounding box is unusable", () => {
    const malformed = { summary: { ...makeSummary(), bbox: undefined } } as unknown as Route;

    expect(getRoutesBounds([malformed])).toBeNull();
  });
});

//#endregion

//#region getCoordinatesBounds

describe("getCoordinatesBounds", () => {
  it("frames a coordinate list", () => {
    expect(
      getCoordinatesBounds([
        [8, 47],
        [12, 51],
        [10, 45],
      ]),
    ).toEqual([
      [8, 45],
      [12, 51],
    ]);
  });

  it("returns a degenerate box for a single point", () => {
    expect(getCoordinatesBounds([[8, 47]])).toEqual([
      [8, 47],
      [8, 47],
    ]);
  });

  it("returns null for an empty list", () => {
    expect(getCoordinatesBounds([])).toBeNull();
  });
});

//#endregion

//#region getLineMidpoint

describe("getLineMidpoint", () => {
  it("returns the exact midpoint of a two-point line", () => {
    const midpoint = getLineMidpoint([
      [0, 0],
      [10, 0],
    ]);

    expect(midpoint?.[0]).toBeCloseTo(5, 6);
    expect(midpoint?.[1]).toBeCloseTo(0, 6);
  });

  it("lands on the correct segment of an L-shaped line", () => {
    // total length 20; the halfway point is at the corner
    const midpoint = getLineMidpoint([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);

    expect(midpoint?.[0]).toBeCloseTo(10, 6);
    expect(midpoint?.[1]).toBeCloseTo(0, 6);
  });

  it("splits a long segment proportionally", () => {
    const midpoint = getLineMidpoint([
      [0, 0],
      [2, 0],
      [10, 0],
    ]);

    expect(midpoint?.[0]).toBeCloseTo(5, 6);
  });

  it("returns the only point of a single-point line", () => {
    expect(getLineMidpoint([[8, 47]])).toEqual([8, 47]);
  });

  it("returns null for an empty line", () => {
    expect(getLineMidpoint([])).toBeNull();
  });
});

//#endregion
