import { describe, expect, it } from "vitest";
import { describeRouteUsage, formatRouteArrival, formatRouteDistance, formatRouteDuration } from "../../src/Routing/routing-format";
import { makeSummary } from "./fixtures";

//#region formatRouteDuration

describe("formatRouteDuration", () => {
  it.each([
    [0, "0m"],
    [59, "1m"],
    [60, "1m"],
    [840, "14m"],
    [3600, "1h"],
    [3660, "1h 1m"],
    [5040, "1h 24m"],
    [86400, "24h"],
  ])("formats %i seconds as %s", (seconds, expected) => {
    expect(formatRouteDuration(seconds, "en")).toBe(expected);
  });

  it("says it in the language it is given", () => {
    expect(formatRouteDuration(5040, "fr")).toBe("1h 24min");
    expect(formatRouteDuration(840, "de")).toBe("14 Min.");
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
    expect(formatRouteDistance(length, units, "en")).toBe(expected);
  });

  it("never falls back to metres for miles", () => {
    expect(formatRouteDistance(0.4, "mi", "en")).toBe("0.4 mi");
  });

  it("takes the language's own decimal separator", () => {
    // French also joins the unit with a narrow no-break space, which is exactly
    // the sort of detail Intl is here to get right
    expect(formatRouteDistance(9.94, "km", "fr")).toBe("9,9\u202fkm");
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

  it("reads the clock in the language it is given", () => {
    const departure = new Date("2026-01-01T22:00:00Z").getTime();

    // en-US is a 12-hour locale and de a 24-hour one, whatever the runner's own
    expect(formatRouteArrival(0, departure, "en-US")).toMatch(/AM|PM/);
    expect(formatRouteArrival(0, departure, "de")).not.toMatch(/AM|PM/);
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
