import { describe, expect, it, vi } from "vitest";
import { buildDirectionsRequest, parseRoutingErrorBody, pruneProfileOptions, waypointsToLocations, type ResolvedRoutingState } from "../../src/Routing/routing-request";
import { toWaypoint } from "../../src/Routing/routing-waypoints";
import type { RoutingProfileOptions } from "../../src/Routing/types";

function makeState(overrides: Partial<ResolvedRoutingState> = {}): ResolvedRoutingState {
  return {
    profile: "car",
    profileOptions: {},
    waypoints: [toWaypoint([8.54, 47.37]), toWaypoint([12.87, 50.23])],
    units: "km",
    language: "en",
    alternates: 2,
    detailLevel: "instructions",
    ...overrides,
  };
}

//#region pruneProfileOptions

describe("pruneProfileOptions", () => {
  it("keeps only the keys the profile accepts", () => {
    const mixed = { mode: "fastest", type: "road" } as unknown as RoutingProfileOptions;

    expect(pruneProfileOptions("bicycle", mixed)).toEqual({ type: "road" });
  });

  it("keeps truck dimensions for the truck profile", () => {
    const options = { weight: 12, height: 4, hazmat: true } as RoutingProfileOptions;

    expect(pruneProfileOptions("truck", options)).toEqual({ weight: 12, height: 4, hazmat: true });
  });

  it("returns undefined when nothing applies, so the key is omitted rather than sent empty", () => {
    const options = { weight: 12 } as RoutingProfileOptions;

    expect(pruneProfileOptions("pedestrian", options)).toBeUndefined();
  });

  it("returns undefined for an empty option object", () => {
    expect(pruneProfileOptions("car", {})).toBeUndefined();
  });

  it("drops an avoidances object whose switches are all off", () => {
    const options = { avoidances: { tolls: false, ferry: false, highway: false } } as RoutingProfileOptions;

    expect(pruneProfileOptions("car", options)).toBeUndefined();
  });

  it("keeps an avoidances object with at least one switch on", () => {
    const options = { avoidances: { tolls: true, ferry: false } } as RoutingProfileOptions;

    expect(pruneProfileOptions("car", options)).toEqual({ avoidances: { tolls: true, ferry: false } });
  });

  it("warns in development when every supplied option was dropped", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    pruneProfileOptions("pedestrian", { weight: 12 } as RoutingProfileOptions);

    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

//#endregion

//#region waypointsToLocations

describe("waypointsToLocations", () => {
  it("converts located waypoints in order", () => {
    const locations = waypointsToLocations([toWaypoint([8.54, 47.37]), toWaypoint([12.87, 50.23])]);

    expect(locations).toEqual([
      { lon: 8.54, lat: 47.37 },
      { lon: 12.87, lat: 50.23 },
    ]);
  });

  it("skips placeholder rows that have no position", () => {
    expect(waypointsToLocations([toWaypoint([8.54, 47.37]), toWaypoint({}), toWaypoint([12.87, 50.23])])).toHaveLength(2);
  });

  it("forwards heading and the pass-through flag", () => {
    const locations = waypointsToLocations([toWaypoint({ lngLat: [8.54, 47.37], heading: 90, waypoint: false })]);

    expect(locations[0]).toEqual({ lon: 8.54, lat: 47.37, heading: 90, waypoint: false });
  });

  it("omits optional fields that were not set", () => {
    expect(Object.keys(waypointsToLocations([toWaypoint([8.54, 47.37])])[0])).toEqual(["lon", "lat"]);
  });
});

//#endregion

//#region buildDirectionsRequest

describe("buildDirectionsRequest", () => {
  it("builds a request from two located waypoints", () => {
    const request = buildDirectionsRequest(makeState());

    expect(request).toMatchObject({
      profile: "car",
      locations: [
        { lon: 8.54, lat: 47.37 },
        { lon: 12.87, lat: 50.23 },
      ],
      response: { units: "km", language: "en", alternates: 2, additionalData: { detailLevel: "instructions" } },
    });
  });

  it("never sends encodePoints, which the live service rejects", () => {
    const request = buildDirectionsRequest(makeState());

    expect(request?.response).not.toHaveProperty("encodePoints");
  });

  it("returns null when fewer than two waypoints are located", () => {
    expect(buildDirectionsRequest(makeState({ waypoints: [toWaypoint([8.54, 47.37])] }))).toBeNull();
    expect(buildDirectionsRequest(makeState({ waypoints: [] }))).toBeNull();
    expect(buildDirectionsRequest(makeState({ waypoints: [toWaypoint([8.54, 47.37]), toWaypoint({})] }))).toBeNull();
  });

  it("supports more than two waypoints", () => {
    const request = buildDirectionsRequest(makeState({ waypoints: [toWaypoint([0, 0]), toWaypoint([1, 1]), toWaypoint([2, 2])] }));

    expect(request?.locations).toHaveLength(3);
  });

  it("omits alternates when none were asked for", () => {
    expect(buildDirectionsRequest(makeState({ alternates: 0 }))?.response).not.toHaveProperty("alternates");
  });

  it("omits the language when there is no single language to ask for", () => {
    expect(buildDirectionsRequest(makeState({ language: undefined }))?.response).not.toHaveProperty("language");
  });

  it("includes the pruned profile options", () => {
    const request = buildDirectionsRequest(makeState({ profileOptions: { mode: "shortest" } }));

    expect(request?.profileOptions).toEqual({ mode: "shortest" });
  });

  it("omits profileOptions entirely when nothing applies", () => {
    const request = buildDirectionsRequest(makeState({ profile: "pedestrian", profileOptions: {} }));

    expect(request).not.toHaveProperty("profileOptions");
  });

  it("sends departureTime when only that is set", () => {
    expect(buildDirectionsRequest(makeState({ departureTime: "2026-01-01T10:00" }))).toMatchObject({ departureTime: "2026-01-01T10:00" });
  });

  it("prefers arrivalTime and warns when both times are set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const request = buildDirectionsRequest(makeState({ departureTime: "2026-01-01T10:00", arrivalTime: "2026-01-01T18:00" }));

    expect(request).not.toHaveProperty("departureTime");
    expect(request).toMatchObject({ arrivalTime: "2026-01-01T18:00" });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

//#endregion

//#region parseRoutingErrorBody

describe("parseRoutingErrorBody", () => {
  it("reads the message out of a JSON error body", () => {
    expect(parseRoutingErrorBody('{"code":"MT_ROUTING","message":"No route found"}')).toBe("No route found");
  });

  it("falls back to the code when there is no message", () => {
    expect(parseRoutingErrorBody('{"code":"MT_ROUTING"}')).toBe("MT_ROUTING");
  });

  it("passes plain text through, which is how a rejected key answers", () => {
    expect(parseRoutingErrorBody("Invalid API key")).toBe("Invalid API key");
  });

  it("returns undefined for an empty body", () => {
    expect(parseRoutingErrorBody("")).toBeUndefined();
    expect(parseRoutingErrorBody("   ")).toBeUndefined();
  });
});

//#endregion
