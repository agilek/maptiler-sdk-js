import { PROFILE_OPTION_KEYS } from "./routing-constants";
import type { DirectionsRequestOptions, RouteDetailLevel, RoutingLocation, RoutingProfile, RoutingProfileOptions, RoutingUnits, RoutingWaypoint } from "./types";

/** Everything {@link buildDirectionsRequest} needs, already resolved against `config` and the defaults. */
export type ResolvedRoutingState = {
  profile: RoutingProfile;
  profileOptions: RoutingProfileOptions;
  waypoints: RoutingWaypoint[];
  units: RoutingUnits;
  language?: string;
  alternates: number;
  detailLevel: RouteDetailLevel;
  departureTime?: string;
  arrivalTime?: string;
  id?: string;
};

/**
 * Drops profile options the chosen profile does not accept.
 *
 * @param profile - The profile the request is for.
 * @param options - Options as supplied, possibly carrying keys from another profile.
 * @returns The applicable options, or `undefined` when nothing applies — so
 * the key is omitted from the request rather than sent as an empty object.
 *
 * @remarks
 * A UI that keeps one option object across profile switches will accumulate
 * keys from every profile the user visited; sending a truck's `weight` under
 * `profile: "bicycle"` is rejected by the service.
 */
export function pruneProfileOptions(profile: RoutingProfile, options: RoutingProfileOptions): RoutingProfileOptions | undefined {
  const allowed = PROFILE_OPTION_KEYS[profile] as readonly string[];
  const source = options as Record<string, unknown>;
  const pruned: Record<string, unknown> = {};

  for (const key of allowed) {
    const value = source[key];
    if (value === undefined) continue;

    // an avoidances object with every switch off means "avoid nothing", which
    // is the service default — sending it just makes requests differ needlessly
    if (key === "avoidances") {
      const avoidances = value as Record<string, boolean | undefined>;
      if (!Object.values(avoidances).some(Boolean)) continue;
    }

    pruned[key] = value;
  }

  if (Object.keys(pruned).length === 0) {
    if (__MT_NODE_ENV__ === "development" && Object.keys(source).length > 0) {
      console.warn(`[pruneProfileOptions]: None of the given profile options apply to the "${profile}" profile. They were dropped from the request.`);
    }
    return undefined;
  }

  return pruned as RoutingProfileOptions;
}

/**
 * Turns the waypoints that have a position into API locations.
 *
 * @param waypoints - The waypoint list, possibly holding empty placeholder rows.
 * @returns Locations in waypoint order.
 */
export function waypointsToLocations(waypoints: RoutingWaypoint[]): RoutingLocation[] {
  const locations: RoutingLocation[] = [];

  for (const waypoint of waypoints) {
    if (!waypoint.lngLat) continue;

    locations.push({
      lon: waypoint.lngLat[0],
      lat: waypoint.lngLat[1],
      ...(waypoint.heading !== undefined ? { heading: waypoint.heading } : {}),
      ...(waypoint.waypoint !== undefined ? { waypoint: waypoint.waypoint } : {}),
    });
  }

  return locations;
}

/**
 * Builds the request body for a routing session.
 *
 * @param state - The session's resolved state.
 * @returns The request, or `null` when fewer than two waypoints have a
 * position — which is a normal state for a half-filled form, not an error.
 *
 * @remarks
 * `response.encodePoints` is deliberately never sent: the schema documents
 * `false`, but the live service answers `MT_ROUTING / Unexpected routing
 * error` for it, so geometry is always decoded client-side.
 */
export function buildDirectionsRequest(state: ResolvedRoutingState): DirectionsRequestOptions | null {
  const locations = waypointsToLocations(state.waypoints);
  if (locations.length < 2) return null;

  const profileOptions = pruneProfileOptions(state.profile, state.profileOptions);

  let departureTime = state.departureTime;
  if (departureTime && state.arrivalTime) {
    // the API accepts one or the other; an arrival deadline is the more
    // specific intent, so it wins
    console.warn("[buildDirectionsRequest]: Both departureTime and arrivalTime were set. Only arrivalTime is sent.");
    departureTime = undefined;
  }

  return {
    profile: state.profile,
    locations,
    ...(state.id !== undefined ? { id: state.id } : {}),
    ...(departureTime !== undefined ? { departureTime } : {}),
    ...(state.arrivalTime !== undefined ? { arrivalTime: state.arrivalTime } : {}),
    ...(profileOptions ? { profileOptions } : {}),
    response: {
      units: state.units,
      ...(state.language !== undefined ? { language: state.language } : {}),
      ...(state.alternates > 0 ? { alternates: state.alternates } : {}),
      additionalData: { detailLevel: state.detailLevel },
    },
    // the request type is a union discriminated on `profile`, and a `profile`
    // widened to `RoutingProfile` matches no single member of it — the cast
    // asserts the pairing with `profileOptions` that `pruneProfileOptions` has
    // already enforced
  } as DirectionsRequestOptions;
}

/**
 * Extracts the human-readable part of an error response body.
 *
 * @param body - The raw response body.
 * @returns The service's message, or `undefined` when the body is empty.
 *
 * @remarks
 * Errors normally arrive as `{ code, message }`, but a rejected API key
 * answers in plain text, so anything non-JSON is passed through as-is.
 */
export function parseRoutingErrorBody(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = JSON.parse(trimmed) as { message?: string; code?: string };
    return parsed.message ?? parsed.code ?? trimmed;
  } catch {
    return trimmed;
  }
}
