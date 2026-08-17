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
  RoutingReverseProvider,
  RoutingSearchProvider,
  RoutingModeConfig,
  RoutingModeDisplay,
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
  launcher: "maptiler-routing-launcher",
  panel: "maptiler-routing-panel",
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
  waypointClear: "maptiler-routing-waypoint-clear",
  waypointRemove: "maptiler-routing-waypoint-remove",
  waypointGhost: "maptiler-routing-waypoint-ghost",

  suggestions: "maptiler-routing-suggestions",
  suggestion: "maptiler-routing-suggestion",
  suggestionLines: "maptiler-routing-suggestion-lines",
  suggestionPrimary: "maptiler-routing-suggestion-primary",
  suggestionSecondary: "maptiler-routing-suggestion-secondary",

  actions: "maptiler-routing-actions",
  addStop: "maptiler-routing-add-stop",

  filters: "maptiler-routing-filters",
  dropdown: "maptiler-routing-dropdown",
  dropdownToggle: "maptiler-routing-dropdown-toggle",
  dropdownLabel: "maptiler-routing-dropdown-label",
  dropdownMenu: "maptiler-routing-dropdown-menu",
  dropdownRow: "maptiler-routing-dropdown-row",
  dropdownRowLabel: "maptiler-routing-dropdown-row-label",
  dropdownValue: "maptiler-routing-dropdown-value",
  dropdownNumber: "maptiler-routing-dropdown-number",
  dropdownDate: "maptiler-routing-dropdown-date",
  dropdownNote: "maptiler-routing-dropdown-note",
  dropdownStep: "maptiler-routing-dropdown-step",
  dropdownStepperValue: "maptiler-routing-dropdown-stepper-value",
  dropdownReset: "maptiler-routing-dropdown-reset",
  switch: "maptiler-routing-switch",

  status: "maptiler-routing-status",
  empty: "maptiler-routing-empty",
  emptyArt: "maptiler-routing-empty-art",
  emptyTitle: "maptiler-routing-empty-title",
  emptyHint: "maptiler-routing-empty-hint",
  error: "maptiler-routing-error",
  skeleton: "maptiler-routing-skeleton",
  skeletonCard: "maptiler-routing-skeleton-card",

  results: "maptiler-routing-results",
  routes: "maptiler-routing-routes",
  routeCard: "maptiler-routing-route-card",
  routeBody: "maptiler-routing-route-body",
  routeDuration: "maptiler-routing-route-duration",
  routeMeta: "maptiler-routing-route-meta",
  routeMetaItem: "maptiler-routing-route-meta-item",
  routeDescription: "maptiler-routing-route-description",
  routeDetail: "maptiler-routing-route-detail",

  detailTop: "maptiler-routing-detail-top",
  detailBack: "maptiler-routing-detail-back",
  detailTitle: "maptiler-routing-detail-title",
  detailSummary: "maptiler-routing-detail-summary",
  steps: "maptiler-routing-steps",
  step: "maptiler-routing-step",
  stepIcon: "maptiler-routing-step-icon",
  stepLines: "maptiler-routing-step-lines",
  stepText: "maptiler-routing-step-text",
  stepDistance: "maptiler-routing-step-distance",

  icon: "maptiler-routing-icon",
  srOnly: "maptiler-routing-sr-only",
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
  start: "route-start",
  destination: "route-pin",
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

/**
 * Filter sections shown when the consumer does not choose.
 *
 * Every profile takes what applies to it out of this one list, which is what
 * gives each transport mode its own row: the car keeps the route preference and
 * the avoidances, the truck swaps the preference for the vehicle menu, and the
 * bicycle and the pedestrian get a speed instead of either. The order is the
 * design's (RouteFilters), with the units toggle — which the design does not
 * draw — last.
 */
export const DEFAULT_FILTERS: readonly RoutingFilter[] = ["mode", "departure", "vehicle", "bicycleType", "speed", "avoidances", "units"];

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
  close: "Close the directions panel",
  from: "From",
  to: "To",
  stop: "Stop",
  addStop: "Add a stop",
  clearWaypoint: "Clear this field",
  myLocation: "My location",
  selectFromMap: "Select from map",
  locating: "Locating…",
  removeStop: "Remove this stop",
  reorderStop: "Reorder this stop",
  routes: "Routes",
  recalculating: "Recalculating…",
  loading: "Calculating the route…",
  needsWaypoints: "Pick a start and a destination to see routes.",
  noRoutes: "No routes found",
  noRoutesHint: "Try changing your start point, destination, or transport mode.",
  error: "The routing request failed.",
  errors: {
    tooFar: "This route is too long for this transport mode. Try another mode, or bring the stops closer together.",
    noRoute: "No route between these points for this transport mode.",
    unreachable: "One of the stops is not on a road. Move it closer to one.",
    unauthorized: "This API key cannot compute routes.",
    rateLimited: "Too many route requests. Try again in a moment.",
    unavailable: "The routing service is unavailable. Try again shortly.",
    unknown: "The routing request failed.",
  },
  backToRoutes: "Back to the routes",
  routeOverview: "Route overview",
  showDetail: "Show the turn-by-turn directions",
  noSteps: "This route came back without step details.",
  eta: "ETA",
  transportMode: "Transport mode",
  modes: { car: "Car", truck: "Truck", bicycle: "Bike", pedestrian: "Walk" },
  units: "Distance units",
  avoid: "Avoid",
  avoidances: { tolls: "Tolls", highway: "Highways", ferry: "Ferries" },
  routeModes: { fastest: "Fastest", shortest: "Shortest", balanced: "Balanced" },
  departure: "Departure",
  departNow: "Now",
  today: "Today",
  tomorrow: "Tomorrow",
  previousDay: "Previous day",
  nextDay: "Next day",
  earlier: "Earlier",
  later: "Later",
  vehicle: "Truck options",
  vehicleFields: { height: "Height", length: "Length", weight: "Weight", axleLoad: "Axle load", topSpeed: "Max speed", hazmat: "Hazardous materials" },
  bicycleType: "Bicycle",
  bicycleTypes: { road: "Road bike", gravel: "Gravel bike", mountain: "Mountain bike", city: "City bike" },
  speed: "Speed",
  speedUnit: "km/h",
  cyclingSpeed: "Cycling speed",
  walkingSpeed: "Walking speed",
  speedHint: "Your average speed is used for time estimates and doesn’t affect route selection.",
});

/**
 * Built-in formatters, bound to a language.
 *
 * @param language - Language code the values are written in. Defaults to the
 * runtime's own locale.
 *
 * @remarks
 * Every value the panel prints goes through `Intl` with this language, so
 * `config.primaryLanguage` reaches the numbers, the units and the clock even
 * though the SDK ships no translated labels.
 */
export function defaultFormatters(language?: string): Required<RoutingControlFormatters> {
  return {
    distance: (length, units) => formatRouteDistance(length, units, language),
    duration: (seconds) => formatRouteDuration(seconds, language),
    arrival: (seconds) => formatRouteArrival(seconds, undefined, language),
    // the only default with prose in it, and the only one a language cannot
    // reach: there is no locale data for a sentence. Override it, as with the
    // labels, to say it in another language.
    routeDescription: describeRouteUsage,
    // typed as always present, but both fields are optional in practice
    waypointLabel: (feature) => {
      const { place_name: placeName, text } = feature as { place_name?: string; text?: string };
      return placeName ?? text ?? "";
    },
  };
}

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
  /** Absent means MapTiler Geocoding, which is the default. */
  provider?: RoutingSearchProvider;
  /** Absent means MapTiler Geocoding. */
  reverse?: RoutingReverseProvider;
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
  launcher: boolean;
  open: boolean;
  className?: string;
  unstyled: boolean;
  modes: RoutingModeConfig[];
  modeDisplay: RoutingModeDisplay;
  showSingleMode: boolean;
  profile?: RoutingProfile;
  filters: readonly RoutingFilter[];
  avoidances: readonly RoutingAvoidanceId[];
  /** The unit the session starts in, already resolved to a concrete one. */
  units: import("../types").RoutingUnits;
  /** Whether the end user may change it. */
  unitsSwitchable: boolean;
  language?: string;
  alternates: number;
  maxWaypoints: number;
  waypoints?: readonly import("../types").RoutingWaypointInput[];
  search: ResolvedSearchOptions;
  clickToAddWaypoint: RoutingClickToAdd;
  dragWaypointsOnMap: boolean;
  pickWaypointOnRightClick: boolean;
  reorderWaypoints: boolean;
  turnByTurn: ResolvedTurnByTurnOptions;
  fitBoundsOnResult: boolean;
  labels: Required<RoutingControlLabels>;
  formatters: Required<RoutingControlFormatters>;
  theme: RoutingControlTheme;
  renderers: RoutingControlRenderers;
  onCreate?: (root: HTMLElement, control: never) => void;
};

/** Locales whose regions measure road distances in miles. */
const IMPERIAL_REGIONS = new Set(["US", "GB", "LR", "MM"]);

/**
 * Picks a distance unit from the environment, for `units: "auto"`.
 *
 * The SDK's own `config.unit` wins when the developer has set it — that is an
 * explicit decision about the whole map. Failing that the region of the
 * browser's locale decides, which is the closest thing to "the user's
 * settings" a page can read.
 */
function detectUnits(): import("../types").RoutingUnits {
  if (config.unit === "imperial") return "mi";
  if (config.unit === "metric") return "km";

  const locale = typeof navigator === "undefined" ? undefined : navigator.language;
  const region = locale ? new Intl.Locale(locale).maximize().region : undefined;
  return region !== undefined && IMPERIAL_REGIONS.has(region) ? "mi" : "km";
}

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

  // Language modes such as STYLE or VISITOR carry a null code — there is no one
  // language to ask for, so this falls through to the runtime's own locale, as
  // the session does for the service's instructions.
  const language = options.language ?? config.primaryLanguage.code ?? undefined;

  return {
    position: options.position ?? "top-left",
    launcher: options.launcher ?? true,
    // the panel is the control's point, so it starts expanded; the launcher is
    // there to close it again
    open: options.open ?? true,
    className: options.className,
    unstyled: options.unstyled ?? false,
    modes: (options.modes ?? DEFAULT_MODES).map((mode) => (typeof mode === "string" ? { id: mode } : mode)),
    modeDisplay: options.modeDisplay ?? "both",
    showSingleMode: options.showSingleMode ?? true,
    profile: options.profile,
    filters: options.filters ?? DEFAULT_FILTERS,
    avoidances: options.avoidances ?? DEFAULT_AVOIDANCES,
    units: options.units === "km" || options.units === "mi" ? options.units : detectUnits(),
    unitsSwitchable: options.units === "shown",
    language,
    alternates: options.alternates ?? 2,
    maxWaypoints: options.maxWaypoints ?? DEFAULT_MAX_WAYPOINTS,
    waypoints: options.waypoints,
    search: {
      enabled: options.search !== false,
      minLength: search.minLength ?? DEFAULT_SEARCH_MIN_LENGTH,
      debounceMs: search.debounceMs ?? DEFAULT_SEARCH_DEBOUNCE_MS,
      limit: search.limit ?? DEFAULT_SEARCH_LIMIT,
      country: search.country,
      provider: search.provider,
      reverse: search.reverse,
      proximity: search.proximity ?? true,
    },
    clickToAddWaypoint: options.clickToAddWaypoint ?? "armed",
    dragWaypointsOnMap: options.dragWaypointsOnMap ?? true,
    pickWaypointOnRightClick: options.pickWaypointOnRightClick ?? true,
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
      errors: { ...DEFAULT_LABELS.errors, ...options.labels?.errors },
      vehicleFields: { ...DEFAULT_LABELS.vehicleFields, ...options.labels?.vehicleFields },
      bicycleTypes: { ...DEFAULT_LABELS.bicycleTypes, ...options.labels?.bicycleTypes },
    },
    formatters: { ...defaultFormatters(language), ...options.formatters },
    // "auto" is the reader's own choice, which is the right default for a
    // control dropped onto someone else's page
    theme: options.theme ?? "auto",
    renderers: options.renderers ?? {},
    onCreate: options.onCreate as ResolvedControlOptions["onCreate"],
  };
}

//#endregion
