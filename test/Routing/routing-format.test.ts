import { describe, expect, it } from "vitest";
import { describeRouteUsage, formatRouteArrival, formatRouteDistance, formatRouteDuration } from "../../src/Routing/routing-format";
import { makeSummary } from "./fixtures";

//#region formatRouteDuration

describe("formatRouteDuration", () => {
  it.each([
    [0, "0 min"],
    [59, "1 min"],
    [60, "1 min"],
    [840, "14 min"],
    [3600, "1 h"],
    [3660, "1 h 1 min"],
    [5040, "1 h 24 min"],
    [86400, "24 h"],
  ])("formats %i seconds as %s", (seconds, expected) => {
    expect(formatRouteDuration(seconds)).toBe(expected);
  });
});

//#endregion

//#region formatRouteDistance

describe("formatRouteDistance", () => {
  it.each([
    [0.4, "km", "400 m"],
    [0.999, "km", "999 m"],
    [1, "km", "1.0 km"],
    [9.94, "km", "9.9 km"],
    [10, "km", "10 km"],
    [123.4, "km", "123 km"],
  ] as const)("formats %f %s as %s", (length, units, expected) => {
    expect(formatRouteDistance(length, units)).toBe(expected);
  });

  it("never falls back to metres for miles", () => {
    expect(formatRouteDistance(0.4, "mi")).toBe("0.4 mi");
  });
});

//#endregion

//#region formatRouteArrival

describe("formatRouteArrival", () => {
  it("is deterministic when the departure instant is supplied", () => {
    const departure = new Date("2026-01-01T10:00:00Z").getTime();

    // the exact string depends on the runner's locale and timezone, so assert
    // it against the same computation rather than a hardcoded clock time
    const expected = new Date(departure + 5040 * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    expect(formatRouteArrival(5040, departure)).toBe(expected);
  });

  it("advances by the travel time", () => {
    const departure = new Date("2026-01-01T10:00:00Z").getTime();

    expect(formatRouteArrival(3600, departure)).not.toBe(formatRouteArrival(0, departure));
  });
});

//#endregion

//#region describeRouteUsage

describe("describeRouteUsage", () => {
  it("describes a route that uses nothing notable", () => {
    expect(describeRouteUsage(makeSummary())).toBe("No tolls, highways or ferries");
  });

  it("describes a single usage", () => {
    expect(describeRouteUsage(makeSummary({ toll: true }))).toBe("Uses tolls");
  });

  it("joins two usages with 'and'", () => {
    expect(describeRouteUsage(makeSummary({ highway: true, toll: true }))).toBe("Uses highways and tolls");
  });

  it("joins three usages with commas and a final 'and'", () => {
    expect(describeRouteUsage(makeSummary({ highway: true, toll: true, ferry: true }))).toBe("Uses highways, tolls and a ferry");
  });

  it("ignores flags that are explicitly false", () => {
    expect(describeRouteUsage(makeSummary({ highway: false, toll: false, ferry: false }))).toBe("No tolls, highways or ferries");
  });
});

//#endregion
