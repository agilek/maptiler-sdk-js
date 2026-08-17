import type { RouteSummary, RoutingUnits } from "./types";

/**
 * `Intl.NumberFormat` instances, keyed by everything that shapes one.
 *
 * A route card formats three values per alternative, on every render, and
 * building a formatter is the expensive half of using one — so they are built
 * once per (locale, unit, precision) and kept.
 */
const numberFormats = new Map<string, Intl.NumberFormat>();

/**
 * A formatter for one value-with-unit, in one language.
 *
 * @param locale - BCP 47 tag, or `undefined` for the runtime's own locale.
 * @param unit - A CLDR unit identifier, such as `"kilometer"`.
 * @param fractionDigits - Digits after the decimal separator, exactly.
 * @param unitDisplay - How the unit is written. `"narrow"` is what the design
 * uses for durations (`1h 24m`); `"short"` is the ordinary `9.9 km`.
 */
function unitFormat(locale: string | undefined, unit: string, fractionDigits: number, unitDisplay: "short" | "narrow"): Intl.NumberFormat {
  const key = `${locale ?? ""}|${unit}|${fractionDigits.toString()}|${unitDisplay}`;
  const cached = numberFormats.get(key);
  if (cached) return cached;

  const format = new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  numberFormats.set(key, format);
  return format;
}

/**
 * Human-readable travel time.
 *
 * @param seconds - Duration in seconds.
 * @param locale - Language to write it in. Defaults to the runtime's own.
 * @returns For example `"14m"`, `"1h"`, `"1h 24m"` in English — the narrow
 * units the design's route card uses. Another language gets its own: `"1 h"`
 * and `"24 min"` in French.
 */
export function formatRouteDuration(seconds: number, locale?: string): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const hourPart = unitFormat(locale, "hour", 0, "narrow").format(hours);
  const minutePart = unitFormat(locale, "minute", 0, "narrow").format(minutes);

  if (!hours) return minutePart;
  return minutes ? `${hourPart} ${minutePart}` : hourPart;
}

/**
 * Human-readable distance.
 *
 * @param length - Distance in the units the response used.
 * @param units - Those units.
 * @returns For example `"400 m"`, `"9.9 km"`, `"123 km"`. Only metric
 * distances fall back to metres; there is no equivalent sub-unit for miles.
 */
export function formatRouteDistance(length: number, units: RoutingUnits, locale?: string): string {
  if (units === "km" && length < 1) return unitFormat(locale, "meter", 0, "short").format(Math.round(length * 1000));

  const unit = units === "km" ? "kilometer" : "mile";
  if (length < 10) return unitFormat(locale, unit, 1, "short").format(length);
  return unitFormat(locale, unit, 0, "short").format(Math.round(length));
}

/**
 * Clock time a route would arrive at, in the viewer's own timezone.
 *
 * @param seconds - Travel time in seconds.
 * @param now - Instant the journey starts from, as a timestamp in
 * milliseconds. Defaults to the current time; pass it explicitly to keep a
 * caller (or a test) deterministic.
 */
export function formatRouteArrival(seconds: number, now: number = Date.now(), locale?: string): string {
  // the locale decides the 12- or 24-hour clock along with the separator, which
  // is the whole point of passing it
  return new Date(now + seconds * 1000).toLocaleTimeString(locale ?? [], { hour: "2-digit", minute: "2-digit" });
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
