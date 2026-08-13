import type { FitBoundsOptions, MarkerOptions } from "maplibre-gl";
import type { Map as SDKMap } from "../Map";
import type { RoutingController } from "./RoutingController";

//#region Primitives

/**
 * Transport profile a route is computed for.
 *
 * Declared as a const object so it can be used as both a value and a type: the
 * profile drives runtime lookups (which profile options apply, which UI
 * controls are relevant).
 */
export const RoutingProfile = {
  /** Passenger car. Accepts {@link CarProfileOptions}. */
  CAR: "car",
  /** Heavy goods vehicle. Accepts {@link TruckProfileOptions}. */
  TRUCK: "truck",
  /** Bicycle. Accepts {@link BicycleProfileOptions}. */
  BICYCLE: "bicycle",
  /** On foot. Accepts {@link PedestrianProfileOptions}. */
  PEDESTRIAN: "pedestrian",
} as const;

/** Transport profile a route is computed for. */
export type RoutingProfile = (typeof RoutingProfile)[keyof typeof RoutingProfile];

/**
 * Distance unit lengths are reported in.
 * `km` also reports metres for distances below one kilometre.
 */
export type RoutingUnits = "km" | "mi";

/** Optimization strategy. {@link RoutingProfile.CAR} only. */
export type CarRouteMode = "fastest" | "shortest" | "balanced";

/** Bicycle sub-type, which changes the surface preference. {@link RoutingProfile.BICYCLE} only. */
export type BicycleRouteType = "road" | "gravel" | "mountain" | "city";

/**
 * How much per-step detail the response carries.
 * - `legs` — leg summaries only, no steps.
 * - `steps` — per-step distance and duration.
 * - `instructions` — steps with maneuvers and human-readable instructions.
 */
export type RouteDetailLevel = "legs" | "steps" | "instructions";

/**
 * Kind of maneuver at the start of a step.
 *
 * Declared as a const object because consumers switch on it, typically to pick
 * an icon.
 */
export const ManeuverType = {
  NONE: "none",
  CONTINUE: "continue",
  SLIGHT_LEFT_TURN: "slightLeftTurn",
  SLIGHT_RIGHT_TURN: "slightRightTurn",
  LEFT_TURN: "leftTurn",
  RIGHT_TURN: "rightTurn",
  LEFT_SHARP_TURN: "leftSharpTurn",
  RIGHT_SHARP_TURN: "rightSharpTurn",
  LEFT_U_TURN: "leftUTurn",
  RIGHT_U_TURN: "rightUTurn",
  ROUNDABOUT_ENTER: "roundaboutEnter",
  ROUNDABOUT_EXIT: "roundaboutExit",
  START: "start",
  DESTINATION: "destination",
} as const;

/** One of the maneuver kinds the SDK knows about. */
export type KnownManeuverType = (typeof ManeuverType)[keyof typeof ManeuverType];

/**
 * Kind of maneuver at the start of a step.
 *
 * @remarks
 * The service may introduce maneuver kinds without an SDK release, so this
 * type stays open. The `string & Record<never, never>` member keeps unknown
 * values assignable while preserving autocomplete for the known ones — always
 * handle the unknown case.
 */
export type ManeuverType = KnownManeuverType | (string & Record<never, never>);

//#endregion

//#region Request

/** One point a route must pass through. */
export type RoutingLocation = {
  /** Longitude in degrees. */
  lon: number;
  /** Latitude in degrees. */
  lat: number;
  /** Preferred departure heading in degrees clockwise from north, `0`–`360`. */
  heading?: number;
  /**
   * `true` (the service default) ends a leg at this point.
   * `false` makes it a pass-through point inside the current leg.
   */
  waypoint?: boolean;
};

/** Road categories a route should avoid. {@link RoutingProfile.CAR} and {@link RoutingProfile.TRUCK} only. */
export type RoutingAvoidances = {
  /** Avoid toll roads. */
  tolls?: boolean;
  /** Avoid ferry crossings. */
  ferry?: boolean;
  /** Avoid motorways. */
  highway?: boolean;
};

/**
 * Profile options for {@link RoutingProfile.CAR}.
 *
 * @remarks
 * The `?: never` members make the four profile option shapes mutually
 * exclusive at the call site, so passing a truck's `weight` alongside
 * `profile: "car"` is a compile error rather than a silently ignored field.
 */
export type CarProfileOptions = {
  /** Optimization strategy. */
  mode?: CarRouteMode;
  /** Cap on the assumed speed, in km/h. */
  topSpeed?: number;
  /** Road categories to avoid. */
  avoidances?: RoutingAvoidances;

  weight?: never;
  height?: never;
  length?: never;
  axleLoad?: never;
  hazmat?: never;
  type?: never;
  cyclingSpeed?: never;
  walkingSpeed?: never;
};

/** Profile options for {@link RoutingProfile.TRUCK}. */
export type TruckProfileOptions = {
  /** Cap on the assumed speed, in km/h. */
  topSpeed?: number;
  /** Road categories to avoid. */
  avoidances?: RoutingAvoidances;
  /** Total vehicle weight in tonnes. */
  weight?: number;
  /** Vehicle height in metres. */
  height?: number;
  /** Vehicle length in metres. */
  length?: number;
  /** Load per axle in tonnes. */
  axleLoad?: number;
  /** `true` when carrying hazardous materials, which excludes restricted roads. */
  hazmat?: boolean;

  mode?: never;
  type?: never;
  cyclingSpeed?: never;
  walkingSpeed?: never;
};

/** Profile options for {@link RoutingProfile.BICYCLE}. */
export type BicycleProfileOptions = {
  /** Bicycle sub-type, which changes the surface preference. */
  type?: BicycleRouteType;
  /** Average cycling speed in km/h. */
  cyclingSpeed?: number;

  mode?: never;
  topSpeed?: never;
  avoidances?: never;
  weight?: never;
  height?: never;
  length?: never;
  axleLoad?: never;
  hazmat?: never;
  walkingSpeed?: never;
};

/** Profile options for {@link RoutingProfile.PEDESTRIAN}. */
export type PedestrianProfileOptions = {
  /** Average walking speed in km/h. */
  walkingSpeed?: number;

  mode?: never;
  topSpeed?: never;
  avoidances?: never;
  weight?: never;
  height?: never;
  length?: never;
  axleLoad?: never;
  hazmat?: never;
  type?: never;
  cyclingSpeed?: never;
};

/** Every profile option shape. Prefer the profile-specific alias where the profile is known. */
export type RoutingProfileOptions = CarProfileOptions | TruckProfileOptions | BicycleProfileOptions | PedestrianProfileOptions;

/** Resolves a profile to the option shape it accepts. */
export type ProfileOptionsFor<P extends RoutingProfile> = P extends "car"
  ? CarProfileOptions
  : P extends "truck"
    ? TruckProfileOptions
    : P extends "bicycle"
      ? BicycleProfileOptions
      : PedestrianProfileOptions;

/** Shape of the response the service should produce. */
export type RoutingResponseOptions = {
  /** Distance unit. */
  units?: RoutingUnits;
  /** Language code for the instructions. */
  language?: string;
  /** Number of alternative routes to return in addition to the best one. */
  alternates?: number;
  /** How much per-step detail to return. */
  detailLevel?: RouteDetailLevel;
};

/** The parts of a directions request that do not depend on the profile. */
export type BaseDirectionsRequestOptions = {
  /** Opaque id echoed back in the response, useful to correlate concurrent requests. */
  id?: string;
  /** Ordered points the route passes through. At least two are required. */
  locations: RoutingLocation[];
  /** Local departure time as `YYYY-MM-DDTHH:mm`. Mutually exclusive with {@link BaseDirectionsRequestOptions.arrivalTime}. */
  departureTime?: string;
  /** Local arrival time as `YYYY-MM-DDTHH:mm`. Mutually exclusive with {@link BaseDirectionsRequestOptions.departureTime}. */
  arrivalTime?: string;
  /** Shape of the response. */
  response?: RoutingResponseOptions;
};

/**
 * A directions request.
 *
 * Discriminated on {@link RoutingProfile}, so `profileOptions` only accepts the
 * keys the chosen profile supports.
 *
 * @example
 * ```ts
 * const request: DirectionsRequestOptions = {
 *   profile: "bicycle",
 *   locations: [{ lon: 8.54, lat: 47.37 }, { lon: 12.87, lat: 50.23 }],
 *   profileOptions: { type: "gravel" },
 * };
 * ```
 */
export type DirectionsRequestOptions = {
  [P in RoutingProfile]: BaseDirectionsRequestOptions & {
    /** Transport profile. */
    profile: P;
    /** Profile-specific tuning. */
    profileOptions?: ProfileOptionsFor<P>;
  };
}[RoutingProfile];

/** Transport options for a single {@link routing.directions} call. */
export type DirectionsFetchOptions = {
  /** MapTiler Cloud API key. Defaults to `config.apiKey`. */
  apiKey?: string;
  /**
   * Adds the `mtsid` session parameter, which enables session-based billing.
   *
   * Default: value of this option in global config (which is `true` by default).
   */
  session?: boolean;
  /** Aborts the request. */
  signal?: AbortSignal;
};

//#endregion

//#region Response

/** Aggregate figures for a route or one of its legs. */
export type RouteSummary = {
  /** Service-internal cost, comparable only between routes of a single response. */
  cost: number;
  /** Bounding box as `[minLon, minLat, maxLon, maxLat]`. */
  bbox: [number, number, number, number];
  /** Total travel time in seconds. */
  totalTime: number;
  /** Total length, in the units the request asked for. */
  totalLength: number;
  /** `true` when at least one toll road is used. */
  toll?: boolean;
  /** `true` when at least one motorway is used. */
  highway?: boolean;
  /** `true` when at least one ferry is used. */
  ferry?: boolean;
};

/** Road characteristics of a step. */
export type RouteStepDetails = {
  /** The step is on a toll road. */
  toll?: boolean;
  /** The step is on a motorway. */
  highway?: boolean;
  /** The step is on an unpaved surface. */
  rough?: boolean;
  /** The step is a ferry crossing. */
  ferry?: boolean;
};

/** The turn at the beginning of a step. */
export type RouteManeuver = {
  /** Human-readable instruction, in the requested language. */
  instruction?: string;
  /** Motorway exit number, when the maneuver is an exit. */
  exitNumber?: number;
  /** Turn angle in degrees, positive clockwise. */
  turnAngle?: number;
  /** Kind of maneuver. */
  type?: ManeuverType;
};

/** One instruction-sized piece of a leg. */
export type RouteStep = {
  /** Travel time of the step in seconds. */
  time: number;
  /** Length of the step, in the units the request asked for. */
  length: number;
  /** Name of the road the step follows, when known. */
  streetName?: string;
  /** The turn at the start of the step. Present when `detailLevel` is `instructions`. */
  maneuver?: RouteManeuver;
  /** Index of the step's first coordinate within its leg geometry. */
  beginIndex?: number;
  /** Index of the step's last coordinate within its leg geometry. */
  endIndex?: number;
  /** Road characteristics of the step. */
  details?: RouteStepDetails;
};

/** The stretch of a route between two consecutive waypoints. */
export type RouteLeg = {
  /** Aggregate figures for this leg. */
  summary: RouteSummary;
  /**
   * Geometry, as an encoded polyline (precision 6) or as `[lon, lat]` pairs.
   *
   * @remarks Use {@link routing.getLegCoordinates} rather than reading this
   * directly — it handles both encodings.
   */
  geometry: string | [number, number][];
  /** Steps of the leg. Absent when `detailLevel` is `legs`. */
  steps?: RouteStep[];
};

/** A complete route, from the first location to the last. */
export type Route = {
  /** Aggregate figures for the whole route. */
  summary: RouteSummary;
  /** One leg per pair of consecutive waypoints. */
  legs: RouteLeg[];
};

/** The directions response. */
export type DirectionsResponse = {
  /** Echo of the request `id`, when one was sent. */
  id?: string;
  /** The best route found. */
  route: Route;
  /** Alternative routes, when alternates were requested. */
  alternates?: Route[];
  /** Attribution text that must be displayed alongside the route. */
  attribution?: string;
  /** Unit the lengths are expressed in. */
  units?: RoutingUnits;
  /** Language the instructions are in. */
  language?: string;
};

//#endregion

//#region Waypoints

/** A waypoint held by a {@link RoutingController}. */
export type RoutingWaypoint = {
  /** Stable id, generated on creation. Survives reordering and edits. */
  readonly id: string;
  /** Position as `[lon, lat]`, or `null` for a placeholder the user has not filled in yet. */
  lngLat: [number, number] | null;
  /** Display label, typically a geocoded place name. */
  label?: string;
  /** Preferred departure heading in degrees clockwise from north. */
  heading?: number;
  /** `false` makes this a pass-through point rather than a leg boundary. */
  waypoint?: boolean;
};

/**
 * Anything accepted where a waypoint can be supplied: a coordinate pair, a
 * `{ lng, lat }` / `{ lon, lat }` object, or a partial waypoint.
 */
export type RoutingWaypointInput = [number, number] | { lng: number; lat: number } | { lon: number; lat: number } | (Partial<Omit<RoutingWaypoint, "id">> & { id?: string });

//#endregion

//#region Rendering options

/** Paint of one route line state. */
export type RouteLineStyle = {
  /** Line color. */
  color: string;
  /** Line width in pixels. */
  width: number;
  /** Line opacity, `0`–`1`. */
  opacity: number;
};

/** Paint of the casing drawn beneath the route lines. */
export type RouteCasingStyle = RouteLineStyle & {
  /** `false` omits the casing layer entirely. */
  enabled: boolean;
};

/** How routes are drawn on the map. */
export type RouteRenderOptions = {
  /** Paint of the selected route. */
  selected?: Partial<RouteLineStyle>;
  /** Paint of the non-selected alternates. */
  alternate?: Partial<RouteLineStyle>;
  /** Paint of the casing drawn under both. */
  casing?: Partial<RouteCasingStyle>;
  /**
   * Layer the route layers are inserted before.
   *
   * Defaults to the style's first `symbol` layer, so labels stay above the
   * route. Pass `null` to append the route on top of everything.
   */
  beforeId?: string | null;
  /**
   * Width in pixels of the invisible line used for click and hover
   * hit-testing. Wider than the drawn line so thin alternates stay clickable.
   */
  hitTestWidth?: number;
};

/** How waypoints are drawn on the map. */
export type RouteWaypointRenderOptions = {
  /** Base MapLibre marker options applied to every waypoint marker. */
  marker?: MarkerOptions;
  /** Marker options merged on top for the first waypoint. */
  origin?: MarkerOptions;
  /** Marker options merged on top for the last waypoint. */
  destination?: MarkerOptions;
  /** Whether a waypoint marker can be dragged to move it. */
  draggable?: boolean;
};

/** Camera behavior applied when a new set of routes arrives. */
export type RouteFitBoundsOptions = Pick<FitBoundsOptions, "padding" | "maxZoom" | "duration" | "essential" | "offset">;

//#endregion

//#region Controller options

/**
 * Options for {@link Map.enableRouting} and the {@link MapOptions.routing} map
 * option.
 *
 * @remarks
 * Resolution order for every value: the explicit option here, then the global
 * `config` where one applies (`apiKey`, `session`, `unit`, `primaryLanguage`),
 * then the module's built-in default.
 */
export type RoutingOptions = {
  /** Transport profile used for the first request. Defaults to `car`. */
  profile?: RoutingProfile;
  /**
   * Profiles this session is allowed to use, in display order. A routing UI
   * renders exactly these.
   *
   * {@link RoutingController.setProfile} warns and ignores anything outside
   * the list. Defaults to all four profiles.
   */
  profiles?: RoutingProfile[];
  /** Profile-specific tuning for the first request. */
  profileOptions?: RoutingProfileOptions;
  /** Waypoints the session starts with. */
  waypoints?: RoutingWaypointInput[];
  /** Distance unit. Defaults to `mi` when `config.unit` is `imperial`, `km` otherwise. */
  units?: RoutingUnits;
  /** Instruction language. Defaults to the language code of `config.primaryLanguage`. */
  language?: string;
  /** Alternatives to request, in addition to the best route. Defaults to `2`. */
  alternates?: number;
  /** Per-step detail level. Defaults to `instructions`. */
  detailLevel?: RouteDetailLevel;
  /** Local departure time as `YYYY-MM-DDTHH:mm`. */
  departureTime?: string;
  /** Local arrival time as `YYYY-MM-DDTHH:mm`. */
  arrivalTime?: string;
  /** Route line and casing paint. `false` draws no lines. */
  render?: RouteRenderOptions | false;
  /** Waypoint marker rendering. `false` draws no waypoint markers. */
  waypointMarkers?: RouteWaypointRenderOptions | false;
  /** Camera fit applied once per successful response. `false` never moves the camera. */
  fitBounds?: RouteFitBoundsOptions | false;
  /** Whether clicking an alternate's line selects it. Defaults to `true`. */
  selectRouteOnClick?: boolean;
  /**
   * Whether a change to the waypoints or the configuration recomputes the
   * route automatically. `false` requires an explicit
   * {@link RoutingController.calculate} call. Defaults to `true`.
   */
  autoCalculate?: boolean;
  /** Debounce in milliseconds before an automatic recompute fires. Defaults to `250`. */
  debounce?: number;
  /** API key override. Defaults to `config.apiKey`. */
  apiKey?: string;
};

//#endregion

//#region Events

/** Fields present on every routing event. */
export type RoutingEventBase = {
  /** The map the routing session belongs to. */
  target: SDKMap;
  /** The controller that fired the event. */
  controller: RoutingController;
};

/** Payload of `routingstart`, fired when a request leaves for the network. */
export type RoutingStartEvent = RoutingEventBase & {
  type: "routingstart";
  /** The request that was sent. */
  request: DirectionsRequestOptions;
};

/** Payload of `routingroutes`, fired once routes have been received and drawn. */
export type RoutingRoutesEvent = RoutingEventBase & {
  type: "routingroutes";
  /** The best route first, then the alternates, in the order the service returned them. */
  routes: Route[];
  /** Index of the selected route within `routes`. */
  selectedIndex: number;
  /** The raw response, for consumers that need `attribution` or `id`. */
  response: DirectionsResponse;
};

/** Payload of `routingselect`, fired when the selected route changes. */
export type RoutingSelectEvent = RoutingEventBase & {
  type: "routingselect";
  /** Index of the newly selected route. */
  selectedIndex: number;
  /** Index that was selected before, or `-1` when nothing was. */
  previousIndex: number;
  /** The newly selected route. */
  route: Route;
};

/** What caused a waypoint list to change. */
export type RoutingWaypointsChangeReason = "add" | "remove" | "move" | "update" | "clear" | "set";

/** Payload of `routingwaypoints`, fired when the waypoint list changes. */
export type RoutingWaypointsEvent = RoutingEventBase & {
  type: "routingwaypoints";
  /** The waypoint list after the change. */
  waypoints: RoutingWaypoint[];
  /** What caused the change. */
  reason: RoutingWaypointsChangeReason;
};

/** Payload of `routingerror`. Aborted requests never fire this event. */
export type RoutingErrorEvent = RoutingEventBase & {
  type: "routingerror";
  /** The failure. An HTTP failure is a `FetchError` carrying `status` and `detail`. */
  error: Error;
};

/** Which part of the session's configuration changed. */
export type RoutingConfigChange = "profile" | "profileOptions" | "units" | "departureTime" | "arrivalTime" | "alternates";

/**
 * Payload of `routingconfig`, fired when the session's configuration changes.
 *
 * @remarks
 * This is what a UI listens to in order to stay in step with the session:
 * switching profile changes which options apply, and switching units changes
 * every distance already on screen. Fired only when a value actually changes.
 */
export type RoutingConfigEvent = RoutingEventBase & {
  type: "routingconfig";
  /** What changed. */
  change: RoutingConfigChange;
};

/** Payload of `routingclear`, fired when drawn routes are removed. */
export type RoutingClearEvent = RoutingEventBase & {
  type: "routingclear";
};

/** Every routing event, keyed by event name. */
export type RoutingEventType = {
  routingstart: RoutingStartEvent;
  routingroutes: RoutingRoutesEvent;
  routingselect: RoutingSelectEvent;
  routingwaypoints: RoutingWaypointsEvent;
  routingconfig: RoutingConfigEvent;
  routingerror: RoutingErrorEvent;
  routingclear: RoutingClearEvent;
};

//#endregion
