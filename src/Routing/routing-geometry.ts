import { decodePolyline } from "./polyline";
import type { Route, RouteLeg } from "./types";

/** A bounding box in `fitBounds` order: `[[minLon, minLat], [maxLon, maxLat]]`. */
export type RouteBounds = [[number, number], [number, number]];

/**
 * Coordinates of one leg, whichever encoding the response used.
 *
 * @param leg - The leg to read.
 * @returns `[lon, lat]` pairs, empty when the leg carries no geometry.
 */
export function getLegCoordinates(leg: RouteLeg): [number, number][] {
  if (typeof leg.geometry === "string") return decodePolyline(leg.geometry);
  // the geometry comes off the wire, so it is checked rather than trusted
  return Array.isArray(leg.geometry) ? leg.geometry : [];
}

/**
 * Every leg of a route joined into one line.
 *
 * @param route - The route to read.
 * @returns `[lon, lat]` pairs. The coordinate shared by the end of one leg and
 * the start of the next appears once, so the line has no duplicated seams.
 */
export function getRouteCoordinates(route: Route): [number, number][] {
  const coordinates: [number, number][] = [];

  route.legs.forEach((leg, index) => {
    const legCoordinates = getLegCoordinates(leg);
    // every leg after the first repeats the previous leg's last point
    coordinates.push(...(index === 0 ? legCoordinates : legCoordinates.slice(1)));
  });

  return coordinates;
}

/**
 * Bounding box of an arbitrary coordinate list.
 *
 * @param coordinates - `[lon, lat]` pairs.
 * @returns The box, or `null` when there is nothing to frame.
 */
export function getCoordinatesBounds(coordinates: [number, number][]): RouteBounds | null {
  if (coordinates.length === 0) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const [lon, lat] of coordinates) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }

  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

/**
 * Bounding box covering every given route.
 *
 * @param routes - The routes to frame.
 * @returns The box, or `null` when no route carries a usable bounding box.
 *
 * @remarks
 * Built from each route's `summary.bbox` rather than from its geometry, so it
 * costs nothing to compute. A route crossing the antimeridian reports a box
 * spanning the whole world; framing such a route zooms out further than it
 * should.
 */
export function getRoutesBounds(routes: Route[]): RouteBounds | null {
  const boxes: number[][] = [];

  for (const route of routes) {
    // the bounding box comes off the wire; a malformed one is skipped rather
    // than trusted into a NaN camera move
    const box = route.summary.bbox as number[] | undefined;
    if (!Array.isArray(box) || box.length < 4) continue;
    boxes.push(box);
  }

  if (boxes.length === 0) return null;

  return [
    [Math.min(...boxes.map((box) => box[0])), Math.min(...boxes.map((box) => box[1]))],
    [Math.max(...boxes.map((box) => box[2])), Math.max(...boxes.map((box) => box[3]))],
  ];
}

/**
 * The coordinate half way along a line, measured by accumulated segment
 * length in degrees.
 *
 * @param coordinates - `[lon, lat]` pairs.
 * @returns The midpoint, or `null` for an empty line.
 *
 * @remarks
 * Degrees are not distance, so this lands near rather than exactly at the
 * halfway point on the ground. That is deliberate: it exists to hang a label
 * on a route, where "somewhere in the middle" is the requirement, and it
 * avoids a per-coordinate geodesic computation on lines that can hold tens of
 * thousands of points.
 */
export function getLineMidpoint(coordinates: [number, number][]): [number, number] | null {
  if (coordinates.length === 0) return null;
  if (coordinates.length === 1) return coordinates[0];

  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    total += Math.hypot(coordinates[i][0] - coordinates[i - 1][0], coordinates[i][1] - coordinates[i - 1][1]);
  }

  let walked = 0;
  const half = total / 2;
  for (let i = 1; i < coordinates.length; i++) {
    const segment = Math.hypot(coordinates[i][0] - coordinates[i - 1][0], coordinates[i][1] - coordinates[i - 1][1]);
    if (walked + segment >= half) {
      const ratio = segment === 0 ? 0 : (half - walked) / segment;
      return [coordinates[i - 1][0] + (coordinates[i][0] - coordinates[i - 1][0]) * ratio, coordinates[i - 1][1] + (coordinates[i][1] - coordinates[i - 1][1]) * ratio];
    }
    walked += segment;
  }

  return coordinates[coordinates.length - 1];
}
