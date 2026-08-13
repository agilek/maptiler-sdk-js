import { config } from "../../config";
import { describeRouteUsage, formatRouteArrival, formatRouteDistance, formatRouteDuration } from "../routing-format";
import type { ManeuverType, RoutingProfile } from "../types";
import type {
  MaptilerRoutingControlOptions,
  RoutingAvoidanceId,
  RoutingControlFormatters,
  RoutingControlLabels,
  RoutingControlRenderers,
  RoutingControlTheme,
  RoutingFilter,
  RoutingModeConfig,
  RoutingClickToAdd,
} from "./routing-ui-types";

//#region Class names

/**
 * Every class name the panel puts in the DOM.
 *
 * This map is the single source of truth for the class-name contract: the
 * names are public API, documented in the README, and the shipped stylesheet
 * selects on exactly these.
 */
export const RC = Object.freeze({
  root: "maptiler-routing",
  header: "maptiler-routing-header",
  title: "maptiler-routing-title",
  toggle: "maptiler-routing-toggle",
  body: "maptiler-routing-body",
  view: "maptiler-routing-view",

  modes: "maptiler-routing-modes",
  mode: "maptiler-routing-mode",

  waypoints: "maptiler-routing-waypoints",
  waypoint: "maptiler-routing-waypoint",
  waypointHandle: "maptiler-routing-waypoint-handle",
  waypointField: "maptiler-routing-waypoint-field",
  waypointPin: "maptiler-routing-waypoint-pin",
  waypointInput: "maptiler-routing-waypoint-input",
  waypointRemove: "maptiler-routing-waypoint-remove",

  suggestions: "maptiler-routing-suggestions",
  suggestion: "maptiler-routing-suggestion",
  suggestionPrimary: "maptiler-routing-suggestion-primary",
  suggestionSecondary: "maptiler-routing-suggestion-secondary",

  actions: "maptiler-routing-actions",
  addStop: "maptiler-routing-add-stop",
  pickOnMap: "maptiler-routing-pick-on-map",

  filters: "maptiler-routing-filters",
  filter: "maptiler-routing-filter",
  filterLabel: "maptiler-routing-filter-label",
  select: "maptiler-routing-select",
  switchRow: "maptiler-routing-switch-row",
  units: "maptiler-routing-units",
  unit: "maptiler-routing-unit",

  status: "maptiler-routing-status",
  error: "maptiler-routing-error",

  routesHeader: "maptiler-routing-routes-header",
  routes: "maptiler-routing-routes",
  routeCard: "maptiler-routing-route-card",
  routeBody: "maptiler-routing-route-body",
  routeDuration: "maptiler-routing-route-duration",
  routeMeta: "maptiler-routing-route-meta",
  routeDescription: "maptiler-routing-route-description",
  routeDetail: "maptiler-routing-route-detail",

  detailTop: "maptiler-routing-detail-top",
  detailBack: "maptiler-routing-detail-back",
  detailSummary: "maptiler-routing-detail-summary",
  steps: "maptiler-routing-steps",
  step: "maptiler-routing-step",
  stepIcon: "maptiler-routing-step-icon",
  stepText: "maptiler-routing-step-text",
  stepDistance: "maptiler-routing-step-distance",

  icon: "maptiler-routing-icon",
  srOnly: "maptiler-routing-sr-only",
});

//#endregion

//#region Theme

/**
 * Maps a {@link RoutingControlTheme} key to its CSS custom property.
 *
 * The property defaults live in the stylesheet, not here: the panel must look
 * right with no JavaScript-set variables at all, so the theme option only ever
 * writes overrides.
 */
export const CSS_VARS: Readonly<Record<keyof RoutingControlTheme, string>> = Object.freeze({
  accent: "--maptiler-routing-accent",
  accentContrast: "--maptiler-routing-accent-contrast",
  surface: "--maptiler-routing-surface",
  surfaceAlt: "--maptiler-routing-surface-alt",
  surfaceHover: "--maptiler-routing-surface-hover",
  textColor: "--maptiler-routing-text-color",
  mutedColor: "--maptiler-routing-muted-color",
  borderColor: "--maptiler-routing-border-color",
  dangerColor: "--maptiler-routing-danger-color",
  radius: "--maptiler-routing-radius",
  radiusSmall: "--maptiler-routing-radius-small",
  width: "--maptiler-routing-width",
  maxHeight: "--maptiler-routing-max-height",
  fontFamily: "--maptiler-routing-font-family",
  shadow: "--maptiler-routing-shadow",
});

//#endregion

//#region Icons

/** Built-in icon id per transport profile. */
export const PROFILE_ICONS: Readonly<Record<RoutingProfile, string>> = Object.freeze({
  car: "mode-car",
  truck: "mode-truck",
  bicycle: "mode-bicycle",
  pedestrian: "mode-pedestrian",
});

/**
 * Maneuver kind to icon id.
 *
 * @remarks
 * The service may add maneuver kinds without an SDK release, so lookups fall
 * back to the "continue" icon and the raw kind is written to `data-maneuver`
 * on the icon element. A consumer can then supply an icon for a new kind from
 * their own stylesheet, with no new SDK version:
 *
 * ```css
 * .maptiler-routing-icon[data-maneuver="rampRight"] { mask-image: url(…); }
 * ```
 */
const MANEUVER_ICONS = {
  none: "maneuver-continue",
  continue: "maneuver-continue",
  slightLeftTurn: "maneuver-slight-left",
  slightRightTurn: "maneuver-slight-right",
  leftTurn: "maneuver-left",
  rightTurn: "maneuver-right",
  leftSharpTurn: "maneuver-sharp-left",
  rightSharpTurn: "maneuver-sharp-right",
  leftUTurn: "maneuver-uturn-left",
  rightUTurn: "maneuver-uturn-right",
  roundaboutEnter: "maneuver-roundabout",
  roundaboutExit: "maneuver-roundabout",
  start: "maneuver-start",
  destination: "maneuver-destination",
} as const;

/** Icon id used for a maneuver kind the SDK does not know. */
export const DEFAULT_MANEUVER_ICON = "maneuver-continue";

/**
 * Icon id for a maneuver kind.
 *
 * @param type - Kind reported by the service, which may be one the SDK does
 * not know about.
 */
export function maneuverIconId(type?: ManeuverType): string {
  if (!type) return DEFAULT_MANEUVER_ICON;
  return (MANEUVER_ICONS as Record<string, string>)[type] ?? DEFAULT_MANEUVER_ICON;
}

//#endregion

//#region Defaults

/** Transport tabs shown when the consumer does not choose. */
export const DEFAULT_MODES: readonly RoutingProfile[] = ["car", "truck", "bicycle", "pedestrian"];

/** Filter sections shown when the consumer does not choose. */
export const DEFAULT_FILTERS: readonly RoutingFilter[] = ["mode", "departure", "avoidances", "units"];

/** Avoidance switches offered when the consumer does not choose. */
export const DEFAULT_AVOIDANCES: readonly RoutingAvoidanceId[] = ["tolls", "highway", "ferry"];

/** Upper bound on the waypoint count. */
export const DEFAULT_MAX_WAYPOINTS = 10;

/** Minimum characters typed before the geocoder is queried. */
export const DEFAULT_SEARCH_MIN_LENGTH = 2;

/** Debounce applied to geocoder keystrokes, in milliseconds. */
export const DEFAULT_SEARCH_DEBOUNCE_MS = 300;

/** Number of suggestions listed under a waypoint field. */
export const DEFAULT_SEARCH_LIMIT = 5;

/** Every string the panel shows, in English. */
export const DEFAULT_LABELS: Required<RoutingControlLabels> = Object.freeze({
  title: "Directions",
  toggle: "Toggle the directions panel",
  from: "Choose a starting point",
  to: "Choose a destination",
  stop: "Choose a stop",
  addStop: "Add a stop",
  removeStop: "Remove this stop",
  reorderStop: "Reorder this stop",
  pickOnMap: "Add a stop from the map",
  pickOnMapHint: "Click the map to add a stop. Press Escape to cancel.",
  routes: "Routes",
  recalculating: "Recalculating…",
  loading: "Calculating the route…",
  needsWaypoints: "Pick a start and a destination to see routes.",
  noRoutes: "No route between these points for this transport mode.",
  error: "The routing request failed.",
  backToRoutes: "Back to the routes",
  showDetail: "Show the turn-by-turn directions",
  noSteps: "This route came back without step details.",
  eta: "ETA",
  transportMode: "Transport mode",
  modes: { car: "Car", truck: "Truck", bicycle: "Bike", pedestrian: "Walk" },
  units: "Distance units",
  avoid: "Avoid",
  avoidances: { tolls: "Tolls", highway: "Motorways", ferry: "Ferries" },
  routeModes: { fastest: "Fastest", shortest: "Shortest", balanced: "Balanced" },
  departure: "Departure",
  departNow: "Leave now",
});

/** Built-in formatters. */
export const DEFAULT_FORMATTERS: Required<RoutingControlFormatters> = Object.freeze({
  distance: formatRouteDistance,
  duration: formatRouteDuration,
  arrival: (seconds: number) => formatRouteArrival(seconds),
  routeDescription: describeRouteUsage,
  // typed as always present, but both fields are optional in practice
  waypointLabel: (feature) => {
    const { place_name: placeName, text } = feature as { place_name?: string; text?: string };
    return placeName ?? text ?? "";
  },
});

//#endregion

//#region Resolution

/** Search configuration after defaults have been applied. */
export type ResolvedSearchOptions = {
  enabled: boolean;
  minLength: number;
  debounceMs: number;
  limit: number;
  country?: readonly string[];
  proximity: boolean;
};

/** Turn-by-turn configuration after defaults have been applied. */
export type ResolvedTurnByTurnOptions = {
  enabled: boolean;
  zoomOnStepClick: boolean;
  maxZoom: number;
};

/** {@link MaptilerRoutingControlOptions} with every value resolved. */
export type ResolvedControlOptions = {
  position: import("maplibre-gl").ControlPosition;
  collapsible: boolean;
  collapsed: boolean;
  className?: string;
  unstyled: boolean;
  modes: RoutingModeConfig[];
  showModeLabels: boolean;
  profile?: RoutingProfile;
  filters: readonly RoutingFilter[];
  avoidances: readonly RoutingAvoidanceId[];
  units?: import("../types").RoutingUnits;
  language?: string;
  alternates: number;
  maxWaypoints: number;
  waypoints?: readonly import("../types").RoutingWaypointInput[];
  search: ResolvedSearchOptions;
  clickToAddWaypoint: RoutingClickToAdd;
  dragWaypointsOnMap: boolean;
  reorderWaypoints: boolean;
  turnByTurn: ResolvedTurnByTurnOptions;
  fitBoundsOnResult: boolean;
  labels: Required<RoutingControlLabels>;
  formatters: Required<RoutingControlFormatters>;
  theme: RoutingControlTheme;
  cssVariables: Record<string, string>;
  renderers: RoutingControlRenderers;
  onCreate?: (root: HTMLElement, control: never) => void;
};

/**
 * Applies the defaults to a set of control options.
 *
 * @remarks
 * Resolution order: the explicit option, then the global `config` where one
 * applies (`unit`, `primaryLanguage`), then the built-in default. Values are
 * merged one level deep for `labels`, `formatters` and the nested option
 * objects, so a consumer overriding one label keeps the rest.
 */
export function resolveControlOptions(options: MaptilerRoutingControlOptions = {}): ResolvedControlOptions {
  const search = typeof options.search === "object" ? options.search : {};
  const turnByTurn = typeof options.turnByTurn === "object" ? options.turnByTurn : {};

  return {
    position: options.position ?? "top-left",
    collapsible: options.collapsible ?? true,
    collapsed: options.collapsed ?? false,
    className: options.className,
    unstyled: options.unstyled ?? false,
    modes: (options.modes ?? DEFAULT_MODES).map((mode) => (typeof mode === "string" ? { id: mode } : mode)),
    showModeLabels: options.showModeLabels ?? true,
    profile: options.profile,
    filters: options.filters ?? DEFAULT_FILTERS,
    avoidances: options.avoidances ?? DEFAULT_AVOIDANCES,
    units: options.units ?? (config.unit === "imperial" ? "mi" : "km"),
    language: options.language,
    alternates: options.alternates ?? 2,
    maxWaypoints: options.maxWaypoints ?? DEFAULT_MAX_WAYPOINTS,
    waypoints: options.waypoints,
    search: {
      enabled: options.search !== false,
      minLength: search.minLength ?? DEFAULT_SEARCH_MIN_LENGTH,
      debounceMs: search.debounceMs ?? DEFAULT_SEARCH_DEBOUNCE_MS,
      limit: search.limit ?? DEFAULT_SEARCH_LIMIT,
      country: search.country,
      proximity: search.proximity ?? true,
    },
    clickToAddWaypoint: options.clickToAddWaypoint ?? "armed",
    dragWaypointsOnMap: options.dragWaypointsOnMap ?? true,
    reorderWaypoints: options.reorderWaypoints ?? true,
    turnByTurn: {
      enabled: options.turnByTurn !== false,
      zoomOnStepClick: turnByTurn.zoomOnStepClick ?? true,
      maxZoom: turnByTurn.maxZoom ?? 16,
    },
    fitBoundsOnResult: options.fitBoundsOnResult ?? true,
    labels: {
      ...DEFAULT_LABELS,
      ...options.labels,
      modes: { ...DEFAULT_LABELS.modes, ...options.labels?.modes },
      avoidances: { ...DEFAULT_LABELS.avoidances, ...options.labels?.avoidances },
      routeModes: { ...DEFAULT_LABELS.routeModes, ...options.labels?.routeModes },
    },
    formatters: { ...DEFAULT_FORMATTERS, ...options.formatters },
    theme: options.theme ?? {},
    cssVariables: options.cssVariables ?? {},
    renderers: options.renderers ?? {},
    onCreate: options.onCreate as ResolvedControlOptions["onCreate"],
  };
}

//#endregion
