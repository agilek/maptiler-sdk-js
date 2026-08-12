import type { RouteSummary, RoutingUnits } from "./types";

/**
 * Human-readable travel time.
 *
 * @param seconds - Duration in seconds.
 * @returns For example `"14 min"`, `"1 h"`, `"1 h 24 min"`.
 */
export function formatRouteDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (!hours) return `${minutes.toString()} min`;
  return minutes ? `${hours.toString()} h ${minutes.toString()} min` : `${hours.toString()} h`;
}

/**
 * Human-readable distance.
 *
 * @param length - Distance in the units the response used.
 * @param units - Those units.
 * @returns For example `"400 m"`, `"9.9 km"`, `"123 km"`. Only metric
 * distances fall back to metres; there is no equivalent sub-unit for miles.
 */
export function formatRouteDistance(length: number, units: RoutingUnits): string {
  if (units === "km" && length < 1) return `${Math.round(length * 1000).toString()} m`;
  if (length < 10) return `${length.toFixed(1)} ${units}`;
  return `${Math.round(length).toString()} ${units}`;
}

/**
 * Clock time a route would arrive at, in the viewer's own timezone.
 *
 * @param seconds - Travel time in seconds.
 * @param now - Instant the journey starts from, as a timestamp in
 * milliseconds. Defaults to the current time; pass it explicitly to keep a
 * caller (or a test) deterministic.
 */
export function formatRouteArrival(seconds: number, now: number = Date.now()): string {
  return new Date(now + seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Short description of what a route uses, built from its summary flags.
 *
 * @param summary - Summary of the route.
 * @returns For example `"No tolls, highways or ferries"`, `"Uses highways"`,
 * `"Uses highways, tolls and a ferry"`.
 */
export function describeRouteUsage(summary: RouteSummary): string {
  const uses = [summary.highway ? "highways" : null, summary.toll ? "tolls" : null, summary.ferry ? "a ferry" : null].filter((entry): entry is string => entry !== null);

  if (uses.length === 0) return "No tolls, highways or ferries";
  if (uses.length === 1) return `Uses ${uses[0]}`;
  return `Uses ${uses.slice(0, -1).join(", ")} and ${uses[uses.length - 1]}`;
}
