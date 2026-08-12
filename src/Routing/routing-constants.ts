import { config } from "../config";
import type {
  BicycleProfileOptions,
  CarProfileOptions,
  PedestrianProfileOptions,
  RouteCasingStyle,
  RouteFitBoundsOptions,
  RouteLineStyle,
  RouteWaypointRenderOptions,
  RoutingOptions,
  RoutingProfile,
  RoutingProfileOptions,
  RoutingUnits,
  RouteDetailLevel,
  TruckProfileOptions,
} from "./types";

//#region Map object ids

/**
 * Prefix of every source and layer this module adds to a style, so the objects
 * it owns are recognizable in `map.getStyle()`.
 */
export const ROUTING_PREFIX = "maptiler-routing";

/** Id of the GeoJSON source holding one `LineString` per route. */
export const ROUTE_SOURCE_ID = `${ROUTING_PREFIX}-routes`;

/** Id of the casing layer, drawn beneath the route lines. */
export const ROUTE_CASING_LAYER_ID = `${ROUTING_PREFIX}-route-casing`;

/** Id of the route line layer. */
export const ROUTE_LINE_LAYER_ID = `${ROUTING_PREFIX}-route-line`;

/** Id of the invisible, wider layer used for click and hover hit-testing. */
export const ROUTE_HITBOX_LAYER_ID = `${ROUTING_PREFIX}-route-hitbox`;

/** Every layer this module adds, bottom to top — also the order they are added in. */
export const ROUTE_LAYER_IDS = [ROUTE_CASING_LAYER_ID, ROUTE_LINE_LAYER_ID, ROUTE_HITBOX_LAYER_ID] as const;

//#endregion

//#region Defaults

/** Alternatives requested in addition to the best route. */
export const DEFAULT_ALTERNATES = 2;

/** Per-step detail level: full instructions, so a turn-by-turn list can be built. */
export const DEFAULT_DETAIL_LEVEL: RouteDetailLevel = "instructions";

/**
 * Delay before an automatic recompute fires, in milliseconds.
 *
 * This is the module's actual request-rate control: toggling several options
 * in a row, or dragging a waypoint, costs one request rather than one per
 * change.
 */
export const DEFAULT_DEBOUNCE_MS = 250;

/** Width in pixels of the invisible hit-test line. */
export const DEFAULT_HIT_TEST_WIDTH = 20;

/** Paint of the selected route. */
export const DEFAULT_SELECTED_LINE_STYLE: RouteLineStyle = {
  color: "#3174ff",
  width: 6,
  opacity: 1,
};

/** Paint of the non-selected alternates. */
export const DEFAULT_ALTERNATE_LINE_STYLE: RouteLineStyle = {
  color: "#aeb6c7",
  width: 4,
  opacity: 0.9,
};

/** Paint of the casing drawn beneath both. */
export const DEFAULT_CASING_STYLE: RouteCasingStyle = {
  enabled: true,
  color: "#ffffff",
  width: 10,
  opacity: 1,
};

/** Camera fit applied once per successful response. */
export const DEFAULT_FIT_BOUNDS_OPTIONS: RouteFitBoundsOptions = {
  padding: 48,
  maxZoom: 15,
  duration: 800,
  essential: true,
};

/** Every profile, in the order a UI shows them by default. */
export const DEFAULT_PROFILES: RoutingProfile[] = ["car", "truck", "bicycle", "pedestrian"];

//#endregion

//#region Profile capabilities

/**
 * Which `profileOptions` keys each profile accepts — the single source of
 * truth for pruning a request, and for deciding which controls a UI shows.
 *
 * @remarks Kept in sync with the profile option types through the `satisfies`
 * clause: a key that is not part of the corresponding type fails to compile.
 */
export const PROFILE_OPTION_KEYS = {
  car: ["mode", "topSpeed", "avoidances"],
  truck: ["topSpeed", "avoidances", "weight", "height", "length", "axleLoad", "hazmat"],
  bicycle: ["type", "cyclingSpeed"],
  pedestrian: ["walkingSpeed"],
} as const satisfies {
  car: readonly (keyof CarProfileOptions)[];
  truck: readonly (keyof TruckProfileOptions)[];
  bicycle: readonly (keyof BicycleProfileOptions)[];
  pedestrian: readonly (keyof PedestrianProfileOptions)[];
};

/** `true` when the profile optimizes with a {@link CarRouteMode}. */
export function supportsRouteMode(profile: RoutingProfile): boolean {
  return profile === "car";
}

/** `true` when the profile accepts {@link RoutingAvoidances}. */
export function supportsAvoidances(profile: RoutingProfile): boolean {
  return profile === "car" || profile === "truck";
}

//#endregion

//#region Resolved options

/** Route paint after defaults have been merged in — every value is concrete. */
export type ResolvedRenderOptions = {
  /** `false` when the consumer opted out of drawing lines entirely. */
  enabled: boolean;
  selected: RouteLineStyle;
  alternate: RouteLineStyle;
  casing: RouteCasingStyle;
  beforeId?: string | null;
  hitTestWidth: number;
};

/** Waypoint marker rendering after defaults have been merged in. */
export type ResolvedWaypointMarkerOptions = Required<RouteWaypointRenderOptions> & {
  /** `false` when the consumer opted out of waypoint markers entirely. */
  enabled: boolean;
};

/** {@link RoutingOptions} after defaults and global `config` have been applied. */
export type ResolvedRoutingOptions = {
  profile: RoutingProfile;
  profiles: RoutingProfile[];
  profileOptions: RoutingProfileOptions;
  units: RoutingUnits;
  language?: string;
  alternates: number;
  detailLevel: RouteDetailLevel;
  departureTime?: string;
  arrivalTime?: string;
  render: ResolvedRenderOptions;
  waypointMarkers: ResolvedWaypointMarkerOptions;
  fitBounds: RouteFitBoundsOptions | false;
  selectRouteOnClick: boolean;
  autoCalculate: boolean;
  debounce: number;
  apiKey?: string;
};

/**
 * Applies the resolution order to a set of {@link RoutingOptions}:
 * explicit option, then global `config` where one applies, then the built-in
 * default.
 *
 * @remarks
 * `config.unit` and `config.primaryLanguage` are read once, here. The
 * controller deliberately does not subscribe to `config`'s change events: a
 * mid-session unit flip would silently change the numbers an already-rendered
 * route shows without recomputing it.
 */
export function resolveRoutingOptions(options: RoutingOptions = {}): ResolvedRoutingOptions {
  const render = options.render === false ? {} : (options.render ?? {});
  const waypointMarkers = options.waypointMarkers === false ? {} : (options.waypointMarkers ?? {});

  return {
    profile: options.profile ?? "car",
    profiles: options.profiles ?? [...DEFAULT_PROFILES],
    profileOptions: options.profileOptions ?? {},
    units: options.units ?? (config.unit === "imperial" ? "mi" : "km"),
    // Language modes such as STYLE or VISITOR carry a null code — there is no
    // single language to ask the service for, so the option is omitted and the
    // service falls back to its own default.
    language: options.language ?? config.primaryLanguage.code ?? undefined,
    alternates: options.alternates ?? DEFAULT_ALTERNATES,
    detailLevel: options.detailLevel ?? DEFAULT_DETAIL_LEVEL,
    departureTime: options.departureTime,
    arrivalTime: options.arrivalTime,
    render: {
      enabled: options.render !== false,
      selected: { ...DEFAULT_SELECTED_LINE_STYLE, ...render.selected },
      alternate: { ...DEFAULT_ALTERNATE_LINE_STYLE, ...render.alternate },
      casing: { ...DEFAULT_CASING_STYLE, ...render.casing },
      beforeId: render.beforeId,
      hitTestWidth: render.hitTestWidth ?? DEFAULT_HIT_TEST_WIDTH,
    },
    waypointMarkers: {
      enabled: options.waypointMarkers !== false,
      marker: waypointMarkers.marker ?? {},
      origin: waypointMarkers.origin ?? {},
      destination: waypointMarkers.destination ?? {},
      draggable: waypointMarkers.draggable ?? true,
    },
    fitBounds: options.fitBounds === false ? false : { ...DEFAULT_FIT_BOUNDS_OPTIONS, ...options.fitBounds },
    selectRouteOnClick: options.selectRouteOnClick ?? true,
    autoCalculate: options.autoCalculate ?? true,
    debounce: options.debounce ?? DEFAULT_DEBOUNCE_MS,
    apiKey: options.apiKey,
  };
}

//#endregion
