import { describe, expect, it } from "vitest";
import { flattenRouteSteps, getStepCoordinates } from "../../src/Routing/routing-steps";
import type { Route } from "../../src/Routing/types";
import { makeLeg, makeRoute, makeStep, makeSummary } from "./fixtures";

const line: [number, number][] = [
  [0, 0],
  [1, 1],
  [2, 2],
  [3, 3],
  [4, 4],
];

function routeWithSteps(): Route {
  const route = makeRoute([line, line]);
  route.legs[0].steps = [makeStep(), makeStep({ beginIndex: 1, endIndex: 3 }), makeStep({ beginIndex: 3, endIndex: 4 })];
  route.legs[1].steps = [makeStep({ beginIndex: 0, endIndex: 2 }), makeStep({ beginIndex: 2, endIndex: 4 })];
  return route;
}

//#region flattenRouteSteps

describe("flattenRouteSteps", () => {
  it("flattens every leg's steps in travel order", () => {
    const flattened = flattenRouteSteps(routeWithSteps());

    expect(flattened).toHaveLength(5);
    expect(flattened.map((entry) => entry.key)).toEqual(["0-0", "0-1", "0-2", "1-0", "1-1"]);
  });

  it("tags each step with its leg and step index", () => {
    const flattened = flattenRouteSteps(routeWithSteps());

    expect(flattened[3]).toMatchObject({ legIndex: 1, stepIndex: 0 });
  });

  it("returns an empty list when the response carried no steps", () => {
    // this is what detailLevel: "legs" produces
    expect(flattenRouteSteps(makeRoute([line]))).toEqual([]);
  });

  it("skips legs without steps but keeps the indices of those that have them", () => {
    const route = makeRoute([line, line]);
    route.legs[1].steps = [makeStep()];

    const flattened = flattenRouteSteps(route);

    expect(flattened).toHaveLength(1);
    expect(flattened[0].key).toBe("1-0");
  });
});

//#endregion

//#region getStepCoordinates

describe("getStepCoordinates", () => {
  it("returns the inclusive slice a step covers", () => {
    const route = routeWithSteps();
    const [, second] = flattenRouteSteps(route);

    // beginIndex 1, endIndex 3 -> three coordinates
    expect(getStepCoordinates(route, second)).toHaveLength(3);
  });

  it("returns a single coordinate when the step begins and ends at the same index", () => {
    const route = makeRoute([line]);
    route.legs[0].steps = [makeStep({ beginIndex: 2, endIndex: 2 })];

    expect(getStepCoordinates(route, flattenRouteSteps(route)[0])).toHaveLength(1);
  });

  it("defaults a missing beginIndex to the start of the leg", () => {
    const route = makeRoute([line]);
    route.legs[0].steps = [makeStep({ beginIndex: undefined, endIndex: 1 })];

    expect(getStepCoordinates(route, flattenRouteSteps(route)[0])).toHaveLength(2);
  });

  it("defaults a missing endIndex to the end of the leg", () => {
    const route = makeRoute([line]);
    route.legs[0].steps = [makeStep({ beginIndex: 3, endIndex: undefined })];

    expect(getStepCoordinates(route, flattenRouteSteps(route)[0])).toHaveLength(2);
  });

  it("clamps an endIndex past the end of the geometry instead of returning a short slice", () => {
    const route = makeRoute([line]);
    route.legs[0].steps = [makeStep({ beginIndex: 3, endIndex: 99 })];

    const coordinates = getStepCoordinates(route, flattenRouteSteps(route)[0]);

    expect(coordinates).toHaveLength(2);
    expect(coordinates[coordinates.length - 1][0]).toBeCloseTo(4, 6);
  });

  it("clamps a beginIndex past the end of the geometry", () => {
    const route = makeRoute([line]);
    route.legs[0].steps = [makeStep({ beginIndex: 99, endIndex: 99 })];

    expect(getStepCoordinates(route, flattenRouteSteps(route)[0])).toHaveLength(1);
  });

  it("returns an empty array for an out-of-range leg index", () => {
    const route = makeRoute([line]);

    expect(getStepCoordinates(route, { step: makeStep(), legIndex: 7, stepIndex: 0, key: "7-0" })).toEqual([]);
  });

  it("returns an empty array when the leg has no geometry", () => {
    const route: Route = { summary: makeSummary(), legs: [{ ...makeLeg([]), geometry: "", steps: [makeStep()] }] };

    expect(getStepCoordinates(route, flattenRouteSteps(route)[0])).toEqual([]);
  });
});

//#endregion
