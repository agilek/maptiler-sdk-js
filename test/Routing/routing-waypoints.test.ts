import { describe, expect, it } from "vitest";
import { insertWaypoint, moveWaypoint, removeWaypoint, toWaypoint, waypointsEqual } from "../../src/Routing/routing-waypoints";
import type { RoutingWaypoint } from "../../src/Routing/types";

const at = (lon: number, lat: number): RoutingWaypoint => toWaypoint([lon, lat]);

//#region toWaypoint

describe("toWaypoint", () => {
  it("accepts a [lon, lat] pair", () => {
    expect(toWaypoint([8.54, 47.37]).lngLat).toEqual([8.54, 47.37]);
  });

  it("accepts a { lng, lat } object, as MapLibre produces", () => {
    expect(toWaypoint({ lng: 8.54, lat: 47.37 }).lngLat).toEqual([8.54, 47.37]);
  });

  it("accepts a { lon, lat } object, as the Routing API uses", () => {
    expect(toWaypoint({ lon: 8.54, lat: 47.37 }).lngLat).toEqual([8.54, 47.37]);
  });

  it("accepts a partial waypoint and keeps its optional fields", () => {
    const waypoint = toWaypoint({ lngLat: [8.54, 47.37], label: "Zurich", heading: 90, waypoint: false });

    expect(waypoint).toMatchObject({ lngLat: [8.54, 47.37], label: "Zurich", heading: 90, waypoint: false });
  });

  it("represents an empty row as a null position", () => {
    expect(toWaypoint({ label: "" }).lngLat).toBeNull();
  });

  it("generates a distinct id per waypoint", () => {
    expect(toWaypoint([8.54, 47.37]).id).not.toBe(toWaypoint([8.54, 47.37]).id);
  });

  it("keeps an explicitly supplied id", () => {
    expect(toWaypoint({ id: "keep-me", lngLat: [8.54, 47.37] }).id).toBe("keep-me");
  });
});

//#endregion

//#region insertWaypoint

describe("insertWaypoint", () => {
  const list = [at(0, 0), at(1, 1), at(2, 2)];

  it("inserts at the start", () => {
    const inserted = at(9, 9);
    expect(insertWaypoint(list, inserted, 0)[0]).toBe(inserted);
  });

  it("inserts in the middle", () => {
    const inserted = at(9, 9);
    expect(insertWaypoint(list, inserted, 1)[1]).toBe(inserted);
  });

  it("appends when the index is past the end", () => {
    const inserted = at(9, 9);
    const next = insertWaypoint(list, inserted, 99);
    expect(next[next.length - 1]).toBe(inserted);
  });

  it("appends when no index is given", () => {
    const inserted = at(9, 9);
    const next = insertWaypoint(list, inserted);
    expect(next[next.length - 1]).toBe(inserted);
  });

  it("does not mutate the input list", () => {
    insertWaypoint(list, at(9, 9), 0);
    expect(list).toHaveLength(3);
  });
});

//#endregion

//#region moveWaypoint

describe("moveWaypoint", () => {
  it("moves a waypoint forwards", () => {
    const list = [at(0, 0), at(1, 1), at(2, 2)];
    expect(moveWaypoint(list, 0, 2).map((w) => w.lngLat?.[0])).toEqual([1, 2, 0]);
  });

  it("moves a waypoint backwards", () => {
    const list = [at(0, 0), at(1, 1), at(2, 2)];
    expect(moveWaypoint(list, 2, 0).map((w) => w.lngLat?.[0])).toEqual([2, 0, 1]);
  });

  it("returns the identical reference for a no-op move, so no event fires", () => {
    const list = [at(0, 0), at(1, 1)];
    expect(moveWaypoint(list, 1, 1)).toBe(list);
  });

  it("returns the identical reference for an out-of-range index", () => {
    const list = [at(0, 0), at(1, 1)];
    expect(moveWaypoint(list, 0, 9)).toBe(list);
    expect(moveWaypoint(list, -1, 0)).toBe(list);
  });
});

//#endregion

//#region removeWaypoint

describe("removeWaypoint", () => {
  it("removes by id", () => {
    const list = [at(0, 0), at(1, 1)];
    expect(removeWaypoint(list, list[0].id)).toHaveLength(1);
  });

  it("returns the identical reference for an unknown id", () => {
    const list = [at(0, 0)];
    expect(removeWaypoint(list, "nope")).toBe(list);
  });
});

//#endregion

//#region waypointsEqual

describe("waypointsEqual", () => {
  it("is true for two empty lists", () => {
    expect(waypointsEqual([], [])).toBe(true);
  });

  it("is false when a position changes", () => {
    expect(waypointsEqual([at(0, 0)], [at(1, 1)])).toBe(false);
  });

  it("is false when the lists differ in length", () => {
    expect(waypointsEqual([at(0, 0)], [at(0, 0), at(1, 1)])).toBe(false);
  });

  it("is true when only a label changes, because labels do not reach the API", () => {
    const a = toWaypoint({ lngLat: [8.54, 47.37], label: "Zurich" });
    const b = toWaypoint({ lngLat: [8.54, 47.37], label: "Zürich HB" });

    expect(waypointsEqual([a], [b])).toBe(true);
  });

  it("is false after a reorder", () => {
    const list = [at(0, 0), at(1, 1)];
    expect(waypointsEqual(list, moveWaypoint(list, 0, 1))).toBe(false);
  });

  it("is false when a heading changes", () => {
    const a = toWaypoint({ lngLat: [8.54, 47.37], heading: 0 });
    const b = toWaypoint({ lngLat: [8.54, 47.37], heading: 180 });

    expect(waypointsEqual([a], [b])).toBe(false);
  });

  it("treats two empty rows as equal", () => {
    expect(waypointsEqual([toWaypoint({})], [toWaypoint({})])).toBe(true);
  });

  it("is false when one row is empty and the other is located", () => {
    expect(waypointsEqual([toWaypoint({})], [at(0, 0)])).toBe(false);
  });
});

//#endregion
