import { describe, expect, it } from "vitest";
import { classifyRoutingError, RoutingErrorReason } from "../../src/Routing/routing-errors";
import { FetchError } from "../../src/utils/errors";

/** A rejection shaped like the one `routing.directions` throws. */
function fetchError(status: number, detail?: string): FetchError {
  const response = { url: "https://api.maptiler.com/routing/v1/directions", status, statusText: "" } as Response;
  return new FetchError(response, "directions", "routing.directions", detail);
}

describe("classifyRoutingError", () => {
  it.each([
    [401, RoutingErrorReason.UNAUTHORIZED],
    [403, RoutingErrorReason.UNAUTHORIZED],
    [429, RoutingErrorReason.RATE_LIMITED],
    [500, RoutingErrorReason.UNAVAILABLE],
    [503, RoutingErrorReason.UNAVAILABLE],
  ])("classifies HTTP %i as %s", (status, expected) => {
    expect(classifyRoutingError(fetchError(status))).toBe(expected);
  });

  it("recognizes the distance limit, which is what a long walking route hits", () => {
    // the message the live service returns, verbatim
    expect(classifyRoutingError(fetchError(400, "Maximum path distance exceeded"))).toBe(RoutingErrorReason.TOO_FAR);
    expect(classifyRoutingError(fetchError(400, "Path distance exceeds the max distance limit"))).toBe(RoutingErrorReason.TOO_FAR);
    // the numbered form, in case the wording changes
    expect(classifyRoutingError(fetchError(400, '{"error_code":154}'))).toBe(RoutingErrorReason.TOO_FAR);
  });

  it("recognizes a route that does not exist", () => {
    expect(classifyRoutingError(fetchError(400, "No route found"))).toBe(RoutingErrorReason.NO_ROUTE);
    expect(classifyRoutingError(fetchError(400, "Path not found"))).toBe(RoutingErrorReason.NO_ROUTE);
  });

  it("recognizes a stop that is not on a road", () => {
    expect(classifyRoutingError(fetchError(400, "Could not snap location to the road network"))).toBe(RoutingErrorReason.UNREACHABLE);
    expect(classifyRoutingError(fetchError(400, "No edge found near location"))).toBe(RoutingErrorReason.UNREACHABLE);
  });

  it("falls back rather than guessing", () => {
    expect(classifyRoutingError(fetchError(400, "Something new the service started saying"))).toBe(RoutingErrorReason.UNKNOWN);
    expect(classifyRoutingError(fetchError(400))).toBe(RoutingErrorReason.UNKNOWN);
    // an abort, a network failure, a bug: not a FetchError at all
    expect(classifyRoutingError(new Error("Failed to fetch"))).toBe(RoutingErrorReason.UNKNOWN);
    expect(classifyRoutingError(undefined)).toBe(RoutingErrorReason.UNKNOWN);
  });

  it("lets the status win over the body, since a 500 says nothing reliable", () => {
    expect(classifyRoutingError(fetchError(500, "Maximum path distance exceeded"))).toBe(RoutingErrorReason.UNAVAILABLE);
  });
});
