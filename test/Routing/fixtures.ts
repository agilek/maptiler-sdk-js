import type { Route, RouteLeg, RouteStep, RouteSummary } from "../../src/Routing/types";

/**
 * Encodes coordinates the way the Routing API does, so geometry fixtures can
 * be written as readable coordinate lists and still exercise the decoder.
 *
 * Mirrors the reference implementation of the polyline algorithm.
 */
export function encodePolyline(coordinates: [number, number][], precision = 6): string {
  const factor = 10 ** precision;
  let output = "";
  let previousLat = 0;
  let previousLon = 0;

  const encodeValue = (value: number): string => {
    let encoded = value < 0 ? ~(value << 1) : value << 1;
    let chunk = "";
    while (encoded >= 0x20) {
      chunk += String.fromCharCode((0x20 | (encoded & 0x1f)) + 63);
      encoded >>= 5;
    }
    chunk += String.fromCharCode(encoded + 63);
    return chunk;
  };

  for (const [lon, lat] of coordinates) {
    const latValue = Math.round(lat * factor);
    const lonValue = Math.round(lon * factor);
    output += encodeValue(latValue - previousLat);
    output += encodeValue(lonValue - previousLon);
    previousLat = latValue;
    previousLon = lonValue;
  }

  return output;
}

/** A summary with sensible numbers, overridable per test. */
export function makeSummary(overrides: Partial<RouteSummary> = {}): RouteSummary {
  return {
    cost: 100,
    bbox: [8, 47, 13, 51],
    totalTime: 3600,
    totalLength: 100,
    ...overrides,
  };
}

/** A step, with the indices that locate it inside its leg. */
export function makeStep(overrides: Partial<RouteStep> = {}): RouteStep {
  return {
    time: 60,
    length: 1.2,
    streetName: "Bahnhofstrasse",
    maneuver: { instruction: "Turn left onto Bahnhofstrasse", type: "leftTurn" },
    beginIndex: 0,
    endIndex: 1,
    ...overrides,
  };
}

/** A leg whose geometry is encoded from the given coordinates. */
export function makeLeg(coordinates: [number, number][], overrides: Partial<RouteLeg> = {}): RouteLeg {
  return {
    summary: makeSummary(),
    geometry: encodePolyline(coordinates),
    ...overrides,
  };
}

/** A route built from one leg per coordinate list. */
export function makeRoute(legs: [number, number][][], overrides: Partial<Route> = {}): Route {
  return {
    summary: makeSummary(),
    legs: legs.map((coordinates) => makeLeg(coordinates)),
    ...overrides,
  };
}
