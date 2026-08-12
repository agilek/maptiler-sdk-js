import { config, MAPTILER_SESSION_ID } from "../config";
import { defaults } from "../constants/defaults";
import { FetchError } from "../utils/errors";
import { decodePolyline } from "./polyline";
import { describeRouteUsage, formatRouteArrival, formatRouteDistance, formatRouteDuration } from "./routing-format";
import { getCoordinatesBounds, getLegCoordinates, getLineMidpoint, getRouteCoordinates, getRoutesBounds } from "./routing-geometry";
import { parseRoutingErrorBody } from "./routing-request";
import { flattenRouteSteps, getStepCoordinates } from "./routing-steps";
import type { DirectionsFetchOptions, DirectionsRequestOptions, DirectionsResponse } from "./types";

/**
 * Performs the directions request.
 *
 * Kept private to the module: consumers call {@link routing.directions}, which
 * is the documented entry point.
 */
async function fetchDirections(request: DirectionsRequestOptions, options: DirectionsFetchOptions = {}): Promise<DirectionsResponse> {
  const apiKey = options.apiKey ?? config.apiKey;

  // Constructors in this SDK warn and degrade, but a promise-returning call
  // has to reject: there is no working fallback for "no key", and a resolved
  // promise with no routes would be indistinguishable from a real answer.
  if (!apiKey) {
    throw new Error("[routing.directions]: No MapTiler Cloud API key. Set `config.apiKey` or pass `apiKey` in the options.");
  }

  const url = new URL(defaults.routingDirectionsURL);
  url.searchParams.set("key", apiKey);

  // Same opt-in rule as the geocoding module: the session parameter follows
  // the global config unless this call overrides it.
  if (config.session ? options.session !== false : options.session === true) {
    url.searchParams.set("mtsid", MAPTILER_SESSION_ID);
  }

  const fetchFunction = config.fetch ?? fetch;

  const response = await fetchFunction(url.href, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new FetchError(response, "directions", "routing.directions", parseRoutingErrorBody(await response.text()));
  }

  return (await response.json()) as DirectionsResponse;
}

/**
 * The MapTiler Routing API, plus the pure helpers needed to work with its
 * responses.
 *
 * The API key, the session parameter and the custom fetch function are taken
 * from the global `config` unless overridden per call.
 *
 * @example
 * ```ts
 * const response = await routing.directions({
 *   profile: "car",
 *   locations: [
 *     { lon: 8.54, lat: 47.37 },
 *     { lon: 12.87, lat: 50.23 },
 *   ],
 *   response: { alternates: 2 },
 * });
 *
 * const coordinates = routing.getRouteCoordinates(response.route);
 * ```
 *
 * @remarks
 * Requests consume MapTiler Cloud API quota. To draw the result on a map, use
 * {@link Map.enableRouting} instead, which handles rendering, selection and
 * style changes.
 */
export const routing = {
  /**
   * Computes one or more routes through the given locations.
   *
   * @param request - The route to compute.
   * @param options - Per-call API key, session and abort signal.
   * @throws `FetchError` when the service rejects the request, carrying its
   * `status` and the service's own message in `detail`.
   */
  directions: (request: DirectionsRequestOptions, options: DirectionsFetchOptions = {}): Promise<DirectionsResponse> => fetchDirections(request, options),

  decodePolyline,
  getLegCoordinates,
  getRouteCoordinates,
  getRoutesBounds,
  getCoordinatesBounds,
  getLineMidpoint,
  getStepCoordinates,
  flattenRouteSteps,
  formatRouteDuration,
  formatRouteDistance,
  formatRouteArrival,
  describeRouteUsage,
} as const;
