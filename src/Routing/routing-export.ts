import { getRouteCoordinates } from "./routing-geometry";
import type { Route } from "./types";

/** Escapes the five characters XML gives special meaning, for text inside an element or attribute. */
function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      default:
        return "&quot;";
    }
  });
}

/**
 * Encodes a route as a GPX 1.1 track.
 *
 * @param route - The route to encode. Every leg's geometry is decoded and
 * joined into one track segment, in travel order.
 * @param name - Written to `<trk><name>`. Defaults to `"Route"`.
 * @returns A complete GPX document, ready to save or download as-is.
 *
 * @example
 * ```ts
 * const gpx = routing.routeToGpx(route, "Zurich to Karlovy Vary");
 * ```
 */
export function routeToGpx(route: Route, name = "Route"): string {
  const points = getRouteCoordinates(route)
    .map(([lng, lat]) => `<trkpt lat="${lat.toString()}" lon="${lng.toString()}"/>`)
    .join("");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="MapTiler SDK" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <trk><name>${escapeXml(name)}</name><trkseg>${points}</trkseg></trk>`,
    "</gpx>",
  ].join("\n");
}
