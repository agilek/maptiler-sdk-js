import { FetchError } from "../utils/errors";

/**
 * Why a directions request failed, in terms a UI can act on.
 *
 * The service answers with an HTTP status and a sentence, neither of which is
 * worth showing a visitor: the status is not specific enough and the sentence
 * is English, untranslatable and written for a developer. Classifying the
 * failure once, here, is what lets both the panel and a consumer's own UI say
 * something useful — and say it in their own words.
 */
export const RoutingErrorReason = {
  /** The route is longer than the profile allows. Each transport mode has its own ceiling. */
  TOO_FAR: "tooFar",
  /** The service found no way between these points for this profile. */
  NO_ROUTE: "noRoute",
  /** A location could not be attached to the road network — a point at sea, typically. */
  UNREACHABLE: "unreachable",
  /** The API key is missing, wrong, or not entitled to routing. */
  UNAUTHORIZED: "unauthorized",
  /** Too many requests. */
  RATE_LIMITED: "rateLimited",
  /** The service itself is failing. */
  UNAVAILABLE: "unavailable",
  /** Anything else, including a network failure. */
  UNKNOWN: "unknown",
} as const;

/** Why a directions request failed. */
export type RoutingErrorReason = (typeof RoutingErrorReason)[keyof typeof RoutingErrorReason];

/**
 * Patterns in the service's own message, most specific first.
 *
 * The engine behind the API is Valhalla, whose messages are stable strings
 * paired with numbered codes — 154 for the distance limit, 442 for a location
 * it could not snap to a road. Both the number and the wording are matched, so
 * a rephrasing on one side does not lose the classification.
 */
const DETAIL_PATTERNS: readonly { pattern: RegExp; reason: RoutingErrorReason }[] = [
  { pattern: /max(imum)?\s+path\s+distance|exceeds?\s+the\s+max\s+distance|\b154\b/i, reason: RoutingErrorReason.TOO_FAR },
  { pattern: /no\s+(route|path)\s+(found|could)|path\s+not\s+found|\b442\b/i, reason: RoutingErrorReason.NO_ROUTE },
  { pattern: /could\s+not\s+(be\s+)?(snap|match|reach)|unreachable|no\s+edge\s+found|\b171\b/i, reason: RoutingErrorReason.UNREACHABLE },
];

/**
 * Failures that mean "there is no such route" rather than "something broke".
 *
 * They are the answer to the request, not an accident on the way to it: the
 * previous results describe a question that was just replaced, so they are
 * dropped rather than left on screen. Everything else — a rejected key, a spent
 * quota, an outage, a network blip — leaves the last answer standing, because a
 * retry may well put it straight back.
 */
export const NOT_FOUND_REASONS: ReadonlySet<RoutingErrorReason> = new Set([RoutingErrorReason.NO_ROUTE, RoutingErrorReason.UNREACHABLE, RoutingErrorReason.TOO_FAR]);

/**
 * Reduces a failed directions request to a reason.
 *
 * @param error - Whatever the request rejected with: a {@link FetchError} from
 * {@link routing.directions}, or any other error.
 *
 * @example
 * ```ts
 * try {
 *   await routing.directions(request);
 * } catch (error) {
 *   if (routing.classifyError(error) === "tooFar") showModeHint();
 * }
 * ```
 */
export function classifyRoutingError(error: unknown): RoutingErrorReason {
  if (!(error instanceof FetchError)) return RoutingErrorReason.UNKNOWN;

  if (error.status === 401 || error.status === 403) return RoutingErrorReason.UNAUTHORIZED;
  if (error.status === 429) return RoutingErrorReason.RATE_LIMITED;
  if (error.status >= 500) return RoutingErrorReason.UNAVAILABLE;

  const detail = error.detail ?? "";
  for (const { pattern, reason } of DETAIL_PATTERNS) {
    if (pattern.test(detail)) return reason;
  }

  return RoutingErrorReason.UNKNOWN;
}
