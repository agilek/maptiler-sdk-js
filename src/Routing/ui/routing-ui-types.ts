import type { ControlPosition } from "maplibre-gl";
import type { GeocodingFeature } from "@maptiler/client";
import type { BicycleRouteType, CarRouteMode, Route, RouteSummary, RoutingAvoidances, RoutingProfile, RoutingUnits, RoutingWaypoint, RoutingWaypointInput } from "../types";
import type { RoutingErrorReason } from "../routing-errors";
import type { FlatRouteStep } from "../routing-steps";
import type { MaptilerRoutingControl } from "./MaptilerRoutingControl";

//#region Enumerations

/** A filter section of the panel, which can be shown, hidden or reordered. */
export const RoutingFilter = {
  /** Fastest / shortest / balanced. Applies to the car profile only. */
  MODE: "mode",
  /** Departure time picker. */
  DEPARTURE: "departure",
  /** Avoid tolls / motorways / ferries. Applies to the car and truck profiles only. */
  AVOIDANCES: "avoidances",
  /** Vehicle weight, height, length, axle load and hazardous goods. Truck profile only. */
  VEHICLE: "vehicle",
  /** Road / gravel / mountain / city bicycle. Bicycle profile only. */
  BICYCLE_TYPE: "bicycleType",
  /** Cycling or walking speed. Applies to the bicycle and pedestrian profiles only. */
  SPEED: "speed",
  /** Kilometers / miles toggle. */
  UNITS: "units",
} as const;

/** A filter section of the panel. */
export type RoutingFilter = (typeof RoutingFilter)[keyof typeof RoutingFilter];

/** An avoidance switch inside the avoidances menu. */
export type RoutingAvoidanceId = keyof RoutingAvoidances;

/**
 * How the panel decides which distance unit to use.
 *
 * A concrete unit fixes it, `"shown"` lets the end user pick, and `"auto"`
 * takes it from the environment.
 */
export type RoutingUnitsOption = RoutingUnits | "shown" | "auto";

/**
 * What a transport tab shows: its icon, its name, both, or nothing at all —
 * `none` removes the switcher rather than emptying it.
 */
export type RoutingModeDisplay = "icon" | "label" | "both" | "none";

/** How the panel reacts to a click on the map. */
export const RoutingClickToAdd = {
  /** Never. Map clicks are left entirely to the application. */
  OFF: "off",
  /**
   * Only after the user chose "Select from map" in a waypoint field. The
   * default, because it never consumes a click the application expected.
   */
  ARMED: "armed",
  /** Every click on the map appends a waypoint. */
  ALWAYS: "always",
} as const;

/** How the panel reacts to a click on the map. */
export type RoutingClickToAdd = (typeof RoutingClickToAdd)[keyof typeof RoutingClickToAdd];

//#endregion

//#region Sub-options

/**
 * One tab of the transport switcher.
 *
 * @remarks
 * Supplying `modes` replaces the built-in list wholesale — order, labels and
 * icons all come from what is passed. Omit `icon` to keep the built-in one.
 */
export type RoutingModeConfig = {
  /** The routing profile this tab requests. */
  id: RoutingProfile;
  /** Visible label. Falls back to the built-in name for the profile. */
  label?: string;
  /**
   * Icon for the tab: a built-in icon id, or a function building the element
   * to place inside the tab.
   */
  icon?: string | (() => HTMLElement);
  /** Extra class added to this tab, for per-mode styling. */
  className?: string;
};

/**
 * Every string the panel can show.
 *
 * @remarks
 * Missing keys fall back to the built-in English text, so a consumer can
 * translate as much or as little as they need.
 */
export type RoutingControlLabels = {
  /** Accessible name of the control, and of the launcher that opens it. */
  title?: string;
  /** Accessible name of the launcher while the panel is open. */
  close?: string;
  /** Placeholder and accessible name of the first waypoint row. Default: `"From"`. */
  from?: string;
  /** Placeholder and accessible name of the last waypoint row. Default: `"To"`. */
  to?: string;
  /** Placeholder and accessible name of intermediate waypoint rows. Default: `"Stop"`. */
  stop?: string;
  /** The "Add a stop" action. */
  addStop?: string;
  /** Accessible name of the clear button inside a waypoint field. */
  clearWaypoint?: string;
  /** The "use my current location" row offered under an empty field. */
  myLocation?: string;
  /** The "pick this point on the map" row offered under an empty field. */
  selectFromMap?: string;
  /** Shown in a field while the browser is locating the visitor. */
  locating?: string;
  /** Accessible name of a row's remove button. */
  removeStop?: string;
  /** Accessible name of a row's reorder handle. */
  reorderStop?: string;
  /** Heading above the route list. */
  routes?: string;
  /** Heading shown while a new request is in flight and stale results are still visible. */
  recalculating?: string;
  /** Status shown while the first request is in flight. */
  loading?: string;
  /** Status shown when fewer than two waypoints are located. */
  needsWaypoints?: string;
  /** Heading of the empty state, shown when the service returned no route. */
  noRoutes?: string;
  /** Second line of that empty state: what the visitor can do about it. */
  noRoutesHint?: string;
  /** Fallback error text, used when a failure cannot be classified. */
  error?: string;
  /**
   * What to say for each kind of failure.
   *
   * The service's own message is English, aimed at a developer, and reads
   * badly in a panel — "Maximum path distance exceeded" for a walking route
   * across a country. These replace it; the original stays on the element's
   * `title` and in the `routingerror` event.
   */
  errors?: Partial<Record<RoutingErrorReason, string>>;
  /** The back control of the turn-by-turn view. */
  backToRoutes?: string;
  /** Heading of the turn-by-turn view. */
  routeOverview?: string;
  /** Accessible name of the turn-by-turn button on a route card. */
  showDetail?: string;
  /** Shown in the turn-by-turn view when the response carried no steps. */
  noSteps?: string;
  /** Suffix after a route's arrival time. */
  eta?: string;
  /** Group label of the transport switcher. */
  transportMode?: string;
  /** Per-profile tab labels. */
  modes?: Partial<Record<RoutingProfile, string>>;
  /** Group label of the units toggle. */
  units?: string;
  /** Closed-state label of the avoidances menu. */
  avoid?: string;
  /** Per-avoidance labels. */
  avoidances?: Partial<Record<RoutingAvoidanceId, string>>;
  /** Labels of the route preference menu. */
  routeModes?: Partial<Record<CarRouteMode, string>>;
  /** Label of the departure time field. */
  departure?: string;
  /** The "leave now" option of the departure field. */
  departNow?: string;
  /** The day row of the departure picker, while it is set to today. */
  today?: string;
  /** The day row of the departure picker, while it is set to the next day. */
  tomorrow?: string;
  /** Accessible name of the departure picker's step-back-a-day control. */
  previousDay?: string;
  /** Accessible name of the departure picker's step-forward-a-day control. */
  nextDay?: string;
  /** Accessible name of the departure picker's earlier-time control. */
  earlier?: string;
  /** Accessible name of the departure picker's later-time control. */
  later?: string;
  /** Closed-state label of the vehicle menu. */
  vehicle?: string;
  /** Labels of the vehicle fields, all in metric units. */
  vehicleFields?: Partial<Record<"weight" | "height" | "length" | "axleLoad" | "topSpeed" | "hazmat", string>>;
  /** Closed-state label of the bicycle type menu. */
  bicycleType?: string;
  /** Per-bicycle-type labels. */
  bicycleTypes?: Partial<Record<BicycleRouteType, string>>;
  /** Closed-state label of the speed menu. */
  speed?: string;
  /** Unit suffix of the speed field. */
  speedUnit?: string;
  /** Row label of the speed menu on the bicycle profile. */
  cyclingSpeed?: string;
  /** Row label of the speed menu on foot. */
  walkingSpeed?: string;
  /** The note under the speed field, saying what the number does. */
  speedHint?: string;
};

/**
 * Overrides for how values are turned into text.
 *
 * @remarks
 * These run on every render pass, so they should be cheap and free of side
 * effects.
 */
export type RoutingControlFormatters = {
  /** Formats a distance given in the units the response used. */
  distance?: (length: number, units: RoutingUnits) => string;
  /** Formats a duration given in seconds. */
  duration?: (seconds: number) => string;
  /** Formats the arrival time shown on a route card, given the travel time in seconds. */
  arrival?: (seconds: number) => string;
  /** One-line description of what a route uses. */
  routeDescription?: (summary: RouteSummary) => string;
  /** Text put into a waypoint field when a geocoding result is picked. */
  waypointLabel?: (feature: GeocodingFeature) => string;
};

/**
 * Read-only view of the state a render hook is called for.
 *
 * @typeParam T - Extra fields for the specific subsection. Defaults to none,
 * for hooks that render something independent of the routing state.
 */
export type RoutingRenderContext<T = unknown> = T & {
  /** The control, so a replacement subsection can call back into it. */
  readonly control: MaptilerRoutingControl;
  /** Labels after the consumer's overrides were merged in. */
  readonly labels: Required<RoutingControlLabels>;
  /** Formatters after the consumer's overrides were merged in. */
  readonly formatters: Required<RoutingControlFormatters>;
};

/**
 * Escape hatches: each hook replaces one subsection of the panel with an
 * element you build.
 *
 * @remarks
 * A hook is called once per render pass for its subsection. Returning
 * `undefined` or `null` falls back to the built-in rendering, so a hook can
 * take over conditionally. The element you return is owned by the control and
 * is removed when that region re-renders — attach listeners to it, not to the
 * panel root.
 *
 * These exist so replacing one part of the panel never requires forking the
 * control. If you find yourself replacing all of them, use the headless
 * {@link RoutingController} directly instead.
 */
export type RoutingControlRenderers = {
  /** Replaces the transport switcher. */
  transportModes?: (context: RoutingRenderContext<{ modes: readonly RoutingModeConfig[]; selected: RoutingProfile }>) => HTMLElement | null | undefined;
  /** Replaces a single waypoint row. Called once per waypoint. */
  waypointRow?: (
    context: RoutingRenderContext<{ waypoint: RoutingWaypoint; index: number; count: number; role: "origin" | "stop" | "destination" }>,
  ) => HTMLElement | null | undefined;
  /** Replaces one route card. Called once per returned route. */
  routeCard?: (context: RoutingRenderContext<{ route: Route; index: number; selected: boolean }>) => HTMLElement | null | undefined;
  /** Replaces one turn-by-turn step row. */
  step?: (context: RoutingRenderContext<{ entry: FlatRouteStep; index: number }>) => HTMLElement | null | undefined;
  /** Replaces the loading, empty and error placeholders. */
  status?: (context: RoutingRenderContext<{ status: RoutingPanelStatus; error: Error | null }>) => HTMLElement | null | undefined;
  /** Appended at the bottom of the panel, once, when the panel is built. */
  footer?: (context: RoutingRenderContext) => HTMLElement | null | undefined;
};

/** One place offered under a waypoint field. */
export type RoutingSearchResult = {
  /**
   * The place, in full: the second line of the row, and the text the field
   * takes when it is picked.
   */
  label: string;
  /** Position, as `[lng, lat]`. */
  lngLat: [number, number];
  /**
   * The name on its own, for the first line of the row.
   *
   * Defaults to `label`, which is what a provider with nothing shorter to say
   * should leave it as.
   */
  name?: string;
  /** Stable identity, when the provider has one. Used for nothing but keys. */
  id?: string;
};

/**
 * Where the panel's place search gets its results.
 *
 * @param query - What the visitor typed, trimmed, already past `minLength`.
 * @param context - The rest of what the panel knows about the query.
 * @returns The places to list, best first. At most `limit` are shown.
 *
 * @example
 * ```ts
 * new MaptilerRoutingControl({
 *   search: {
 *     provider: async (query, { limit, signal }) => {
 *       const response = await fetch(`/api/places?q=${encodeURIComponent(query)}`, { signal });
 *       const places = await response.json();
 *       return places.slice(0, limit).map((place) => ({
 *         name: place.name,
 *         label: place.address,
 *         lngLat: [place.lng, place.lat],
 *       }));
 *     },
 *   },
 * });
 * ```
 */
export type RoutingSearchProvider = (query: string, context: RoutingSearchContext) => RoutingSearchResult[] | Promise<RoutingSearchResult[]>;

/** What the panel tells a {@link RoutingSearchProvider} about a query. */
export type RoutingSearchContext = {
  /**
   * Where the map is looking, for biasing results towards it.
   *
   * Absent when the `proximity` option is off, which is how "do not bias this"
   * is expressed.
   */
  proximity?: [number, number];
  /** The panel's language, as resolved from the `language` option. */
  language?: string;
  /** How many results the panel will show. Anything past this is dropped. */
  limit: number;
  /**
   * Aborted when the query is superseded or the panel goes away.
   *
   * Pass it to `fetch`: a query nobody is waiting for should not be in flight,
   * and the panel ignores whatever a superseded call returns.
   */
  signal: AbortSignal;
};

/**
 * Names a coordinate: the reverse of a {@link RoutingSearchProvider}.
 *
 * @returns The name for that point, or nothing — a coordinate with no name is
 * ordinary, and the field goes on showing the numbers.
 */
export type RoutingReverseProvider = (lngLat: [number, number], context: RoutingReverseContext) => string | undefined | null | Promise<string | undefined | null>;

/** What the panel tells a {@link RoutingReverseProvider} about a lookup. */
export type RoutingReverseContext = {
  /** The panel's language, as resolved from the `language` option. */
  language?: string;
  /** Aborted when the panel goes away. */
  signal: AbortSignal;
};

/** What the panel is currently showing. */
export type RoutingPanelStatus = "idle" | "loading" | "ready" | "empty" | "error";

/**
 * The two palettes the panel ships.
 *
 * @remarks
 * `"auto"` follows the reader's own `prefers-color-scheme`. There is no option
 * for individual colors: the palettes are the design, and both are declared in
 * the stylesheet as custom properties on the panel root — readable, and
 * overridable from your own CSS if you must.
 */
export type RoutingControlTheme = "light" | "dark" | "auto";

//#endregion

//#region Control options

/**
 * Options for {@link MaptilerRoutingControl}.
 *
 * @remarks
 * Every option is optional: `new MaptilerRoutingControl()` produces a working
 * panel. Options that configure the routing session itself (profiles, units,
 * alternates, waypoints) are forwarded to the map's {@link RoutingController},
 * which is shared with anyone using the headless API on the same map.
 *
 * @example
 * ```ts
 * map.addControl(
 *   new MaptilerRoutingControl({
 *     modes: [{ id: "car" }, { id: "bicycle", label: "Ride" }],
 *     filters: ["departure", "units"],
 *     units: "mi",
 *     theme: { accent: "#e2001a" },
 *     labels: { title: "Itinéraire", from: "Départ", to: "Arrivée" },
 *   }),
 *   "top-left",
 * );
 * ```
 */
export type MaptilerRoutingControlOptions = {
  //#region Placement and shell

  /**
   * Corner the panel is placed in when the control is added through the
   * {@link MapOptions.routingControl} map option.
   *
   * Ignored when the control is added with `map.addControl(control, position)`,
   * where the second argument wins.
   *
   * Default: `"top-left"`
   */
  position?: ControlPosition;

  /**
   * Whether the control shows its launcher: a map-control button that opens
   * the panel, and turns into a close button while it is open.
   *
   * `false` renders the panel on its own, always open — for a layout that
   * already has somewhere to put it.
   *
   * Default: `true`
   */
  launcher?: boolean;

  /**
   * Whether the panel starts open.
   *
   * Default: `true`. Pass `false` to start with only the launcher, leaving the
   * map unobstructed until the user asks for directions.
   */
  open?: boolean;

  /** Extra class names added to the panel root, for scoping your own CSS. */
  className?: string;

  /**
   * Drops the `maptiler-routing` root class, which every shipped style rule is
   * scoped under, so the panel renders unstyled. The DOM structure and the
   * other class names are unchanged, so it can be styled from scratch.
   *
   * Default: `false`
   */
  unstyled?: boolean;

  //#endregion

  //#region Routing configuration

  /**
   * Transport tabs, in the order they appear. Pass an empty array to hide the
   * switcher and pin the profile to `profile`.
   *
   * Default: car, truck, bicycle and pedestrian.
   */
  modes?: readonly (RoutingProfile | RoutingModeConfig)[];

  /**
   * What a transport tab shows.
   *
   * - `both` — icon and name.
   * - `icon` — icon only. The name becomes the tab's accessible name and
   *   tooltip, so nothing is lost for screen readers.
   * - `label` — name only.
   * - `none` — no switcher at all. Nothing is rendered: no tabs, and no
   *   container, so no background, border or spacing is left behind.
   *
   * Default: `"both"`
   */
  modeDisplay?: RoutingModeDisplay;

  /**
   * Whether the switcher renders when only one transport mode is available.
   *
   * With a single mode there is nothing to switch between, so the tab is a
   * label rather than a control. Set this to `false` to drop it entirely —
   * the container goes with it, leaving no background or spacing behind.
   *
   * Default: `true`
   */
  showSingleMode?: boolean;

  /**
   * Transport mode selected on first render.
   *
   * Default: the first entry of `modes`.
   */
  profile?: RoutingProfile;

  /**
   * Which filter sections are shown, in the order they appear. A section that
   * does not apply to the current profile hides itself regardless, which is
   * what gives each transport mode its own row: the route preference is
   * car-only, the vehicle menu truck-only, the bicycle type bicycle-only, the
   * speed bicycle- and pedestrian-only, and the avoidances car- and truck-only.
   *
   * The units toggle additionally needs {@link MaptilerRoutingControlOptions.units}
   * to be `"shown"` — with a fixed unit there is nothing for it to switch.
   *
   * Default: `["mode", "departure", "vehicle", "bicycleType", "speed", "avoidances", "units"]`
   */
  filters?: readonly RoutingFilter[];

  /**
   * Which avoidance switches the avoidances menu offers, in order.
   *
   * Default: `["tolls", "highway", "ferry"]`
   */
  avoidances?: readonly RoutingAvoidanceId[];

  /**
   * Distance units for the request and for every distance shown. This is the
   * developer's choice, not the end user's — except in `"shown"`, which is the
   * one value that hands the decision over.
   *
   * - `"km"` / `"mi"` — fixed. No toggle is rendered.
   * - `"shown"` — the panel renders the units toggle, starting from `"auto"`.
   * - `"auto"` — taken from the environment: `config.unit` when the SDK has
   *   been told, otherwise the region of the browser's locale.
   *
   * Default: `"auto"`
   */
  units?: RoutingUnitsOption;

  /**
   * Language the panel speaks.
   *
   * It reaches the turn-by-turn instructions the service writes, the place
   * names the search returns, and every value the panel formats itself —
   * durations, distances and arrival clocks all go through `Intl` with it.
   *
   * It does **not** translate the panel's own labels: the SDK ships those in
   * English only, and {@link MaptilerRoutingControlOptions.labels} is how they
   * are replaced.
   *
   * Default: the code of `config.primaryLanguage`, so a map configured for one
   * language does not need this option at all. Language *modes* — `STYLE`,
   * `VISITOR` and the like — have no single code, and fall through to the
   * browser's own locale.
   */
  language?: string;

  /**
   * How many alternative routes to request. The panel shows at most
   * `alternates + 1` cards.
   *
   * Default: `2`
   */
  alternates?: number;

  /**
   * Maximum number of waypoints. "Add a stop" disables itself at the limit.
   *
   * Default: `10`
   */
  maxWaypoints?: number;

  /**
   * Waypoints the panel starts with. Two empty rows are shown when omitted.
   */
  waypoints?: readonly RoutingWaypointInput[];

  //#endregion

  //#region Interactions

  /**
   * Whether waypoint fields search MapTiler Geocoding as the user types.
   * When `false` the fields become read-only labels, and waypoints can only be
   * set from the map or programmatically.
   *
   * Default: `true`
   */
  search?:
    | boolean
    | {
        /** Minimum number of characters before a request is made. Default: `2` */
        minLength?: number;
        /** Debounce applied to keystrokes, in milliseconds. Default: `300` */
        debounceMs?: number;
        /** Maximum number of suggestions listed. Default: `5` */
        limit?: number;
        /** Restricts results to these ISO 3166-1 alpha-2 country codes. Ignored by a `provider`. */
        country?: readonly string[];
        /** Biases results towards the current map view. Default: `true` */
        proximity?: boolean;
        /**
         * Answers the field instead of MapTiler Geocoding.
         *
         * Default: MapTiler Geocoding. Supply this only to search somewhere
         * else — your own address database, your own geocoder — and keep the
         * field, the result list, its keyboard handling and the
         * "My location" / "Select from map" rows as they are.
         *
         * The panel debounces, cancels and orders the calls, exactly as it does
         * its own: `minLength`, `debounceMs` and `limit` still apply, and
         * `country` does not — filtering is yours to do. Throwing, or rejecting,
         * shows no suggestions rather than an error.
         *
         * @see {@link RoutingSearchProvider}
         */
        provider?: RoutingSearchProvider;
        /**
         * Names a coordinate instead of MapTiler Geocoding.
         *
         * Used for a waypoint the visitor placed rather than typed — a map
         * click, a right-click, a marker dragged — whose field would otherwise
         * show a coordinate. Pair it with `provider` when the places come from
         * your own data; on its own it renames what our search found.
         *
         * @see {@link RoutingReverseProvider}
         */
        reverse?: RoutingReverseProvider;
      };

  /**
   * Whether clicking the map adds a waypoint, and how.
   *
   * Default: `"armed"`
   */
  clickToAddWaypoint?: RoutingClickToAdd;

  /**
   * Whether waypoint markers can be dragged on the map to re-route.
   *
   * Default: `true`
   */
  dragWaypointsOnMap?: boolean;

  /**
   * Whether right-clicking the map fills a waypoint with that point.
   *
   * It goes to the field the user is in, or to the first empty one, and is
   * independent of {@link MaptilerRoutingControlOptions.clickToAddWaypoint} —
   * a right-click is unambiguous, so it needs no arming.
   *
   * Default: `true`
   */
  pickWaypointOnRightClick?: boolean;

  /**
   * Whether waypoint rows can be reordered, with the row handle or with
   * `Alt`+`ArrowUp` / `Alt`+`ArrowDown`.
   *
   * Default: `true`
   */
  reorderWaypoints?: boolean;

  /**
   * Whether a route card opens a turn-by-turn list, and whether clicking a
   * step frames it on the map.
   *
   * Default: `true`
   */
  turnByTurn?:
    | boolean
    | {
        /** Whether clicking a step zooms the map to it. Default: `true` */
        zoomOnStepClick?: boolean;
        /** Upper zoom bound when framing a step. Default: `16` */
        maxZoom?: number;
      };

  /**
   * Whether the map is framed to the routes after each successful request.
   *
   * Default: `true`
   */
  fitBoundsOnResult?: boolean;

  //#endregion

  //#region Presentation

  /**
   * Text overrides, for localization.
   *
   * The SDK ships every string in English and no translations, so this is how a
   * page in another language gets a panel in that language. Merged one level
   * deep: override one key and the rest stay as they are. The values around
   * them already follow {@link MaptilerRoutingControlOptions.language}.
   */
  labels?: RoutingControlLabels;

  /** Value-formatting overrides. */
  formatters?: RoutingControlFormatters;

  /**
   * Which of the two palettes the panel wears.
   *
   * Default: `"auto"`, which follows the reader's `prefers-color-scheme`.
   */
  theme?: RoutingControlTheme;

  /** Per-subsection render hooks. See {@link RoutingControlRenderers}. */
  renderers?: RoutingControlRenderers;

  /**
   * Called once, after the panel has been built and before it is handed to the
   * map. The place to decorate the DOM the control owns.
   */
  onCreate?: (root: HTMLElement, control: MaptilerRoutingControl) => void;

  //#endregion
};

//#endregion
