import { v4 as uuid } from "uuid";
import type { RoutingWaypoint, RoutingWaypointInput } from "./types";

/** `true` when the value is a `[lon, lat]` pair. */
function isCoordinatePair(input: RoutingWaypointInput): input is [number, number] {
  if (!Array.isArray(input)) return false;
  const values = input as number[];
  return values.length === 2 && typeof values[0] === "number" && typeof values[1] === "number";
}

/**
 * Normalizes any accepted input into a waypoint with a fresh id.
 *
 * @param input - A `[lon, lat]` pair, a `{ lng, lat }` or `{ lon, lat }`
 * object, or a partial waypoint.
 * @returns A waypoint. `lngLat` is `null` when the input carried no usable
 * coordinate, which is how an empty "From"/"To" row is represented.
 */
export function toWaypoint(input: RoutingWaypointInput): RoutingWaypoint {
  if (isCoordinatePair(input)) {
    return { id: uuid(), lngLat: [input[0], input[1]] };
  }

  if ("lng" in input && typeof input.lng === "number" && typeof input.lat === "number") {
    return { id: uuid(), lngLat: [input.lng, input.lat] };
  }

  if ("lon" in input && typeof input.lon === "number" && typeof input.lat === "number") {
    return { id: uuid(), lngLat: [input.lon, input.lat] };
  }

  const partial = input as Partial<RoutingWaypoint>;

  return {
    id: partial.id ?? uuid(),
    lngLat: partial.lngLat ? [partial.lngLat[0], partial.lngLat[1]] : null,
    ...(partial.label !== undefined ? { label: partial.label } : {}),
    ...(partial.heading !== undefined ? { heading: partial.heading } : {}),
    ...(partial.waypoint !== undefined ? { waypoint: partial.waypoint } : {}),
  };
}

/**
 * Inserts a waypoint at an index.
 *
 * @param waypoints - The current list, left untouched.
 * @param waypoint - The waypoint to insert.
 * @param index - Where to insert it. Out-of-range values append.
 * @returns A new list.
 */
export function insertWaypoint(waypoints: RoutingWaypoint[], waypoint: RoutingWaypoint, index?: number): RoutingWaypoint[] {
  const next = [...waypoints];
  const at = index === undefined || index < 0 || index > next.length ? next.length : index;
  next.splice(at, 0, waypoint);
  return next;
}

/**
 * Moves a waypoint from one position to another.
 *
 * @param waypoints - The current list, left untouched.
 * @param from - Index to move.
 * @param to - Index to move it to.
 * @returns A new list, or the identical reference when the move is a no-op —
 * callers use that to skip firing a change event.
 */
export function moveWaypoint(waypoints: RoutingWaypoint[], from: number, to: number): RoutingWaypoint[] {
  if (from === to || from < 0 || to < 0 || from >= waypoints.length || to >= waypoints.length) return waypoints;

  const next = [...waypoints];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Removes a waypoint by id.
 *
 * @param waypoints - The current list, left untouched.
 * @param id - Id to remove.
 * @returns A new list, or the identical reference when the id is unknown.
 */
export function removeWaypoint(waypoints: RoutingWaypoint[], id: string): RoutingWaypoint[] {
  const next = waypoints.filter((waypoint) => waypoint.id !== id);
  return next.length === waypoints.length ? waypoints : next;
}

/**
 * `true` when two waypoint lists would produce an identical request.
 *
 * @remarks
 * Compares only what reaches the API — position, heading and the pass-through
 * flag. A label changing (a geocoder result landing, say) is not a reason to
 * recompute a route.
 */
export function waypointsEqual(a: RoutingWaypoint[], b: RoutingWaypoint[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  return a.every((waypoint, index) => {
    const other = b[index];
    if (waypoint.lngLat === null || other.lngLat === null) return waypoint.lngLat === other.lngLat;
    return waypoint.lngLat[0] === other.lngLat[0] && waypoint.lngLat[1] === other.lngLat[1] && waypoint.heading === other.heading && waypoint.waypoint === other.waypoint;
  });
}
