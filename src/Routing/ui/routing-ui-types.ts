import type { ControlPosition } from "maplibre-gl";
import type { GeocodingFeature } from "@maptiler/client";
import type { CarRouteMode, Route, RouteSummary, RoutingAvoidances, RoutingProfile, RoutingUnits, RoutingWaypoint, RoutingWaypointInput } from "../types";
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
  /** Kilometers / miles toggle. */
  UNITS: "units",
} as const;

/** A filter section of the panel. */
export type RoutingFilter = (typeof RoutingFilter)[keyof typeof RoutingFilter];

/** An avoidance switch inside the avoidances menu. */
export type RoutingAvoidanceId = keyof RoutingAvoidances;

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
   * Only while the user has pressed the "Add stop from map" button. The
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
  /** Panel title. */
  title?: string;
  /** Accessible name of the collapse toggle. */
  toggle?: string;
  /** Placeholder of the first waypoint row. */
  from?: string;
  /** Placeholder of the last waypoint row. */
  to?: string;
  /** Placeholder of intermediate waypoint rows. */
  stop?: string;
  /** The "Add a stop" action. */
  addStop?: string;
  /** Accessible name of a row's remove button. */
  removeStop?: string;
  /** Accessible name of a row's reorder handle. */
  reorderStop?: string;
  /** The "Add stop from map" toggle. */
  pickOnMap?: string;
  /** Hint shown while the map is armed for picking. */
  pickOnMapHint?: string;
  /** Heading above the route list. */
  routes?: string;
  /** Heading shown while a new request is in flight and stale results are still visible. */
  recalculating?: string;
  /** Status shown while the first request is in flight. */
  loading?: string;
  /** Status shown when fewer than two waypoints are located. */
  needsWaypoints?: string;
  /** Status shown when the service returned no route. */
  noRoutes?: string;
  /** Fallback error text when a failure carries no message. */
  error?: string;
  /** The back control of the turn-by-turn view. */
  backToRoutes?: string;
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

/** What the panel is currently showing. */
export type RoutingPanelStatus = "idle" | "loading" | "ready" | "empty" | "error";

/**
 * Theme values, written as CSS custom properties on the panel root.
 *
 * @remarks
 * Every key maps to `--maptiler-routing-<kebab-case-key>`. Setting them here
 * is equivalent to writing the same custom properties in a stylesheet; this
 * object exists so a theme can be applied without shipping CSS.
 */
export type RoutingControlTheme = {
  /** Accent color: the selected tab, active borders, the selected route. */
  accent?: string;
  /** Text color drawn on the accent color. */
  accentContrast?: string;
  /** Panel background. */
  surface?: string;
  /** Secondary surface: the switcher rail and unselected cards. */
  surfaceAlt?: string;
  /** Hover tint of interactive rows. */
  surfaceHover?: string;
  /** Primary text color. */
  textColor?: string;
  /** Secondary text color, used for meta lines. */
  mutedColor?: string;
  /** Default border color. */
  borderColor?: string;
  /** Color of error text. */
  dangerColor?: string;
  /** Corner radius of the panel and its cards. */
  radius?: string;
  /** Corner radius of small controls. */
  radiusSmall?: string;
  /** Panel width. */
  width?: string;
  /** Panel maximum height. */
  maxHeight?: string;
  /** Font stack. */
  fontFamily?: string;
  /** Panel drop shadow. */
  shadow?: string;
};

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
   * Whether the panel has a header with a collapse button.
   *
   * Default: `true`
   */
  collapsible?: boolean;

  /**
   * Whether the panel starts collapsed. Requires `collapsible`.
   *
   * Default: `false`
   */
  collapsed?: boolean;

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
   * does not apply to the current profile hides itself regardless: the route
   * preference is car-only and avoidances are car- and truck-only.
   *
   * Default: `["mode", "departure", "avoidances", "units"]`
   */
  filters?: readonly RoutingFilter[];

  /**
   * Which avoidance switches the avoidances menu offers, in order.
   *
   * Default: `["tolls", "highway", "ferry"]`
   */
  avoidances?: readonly RoutingAvoidanceId[];

  /**
   * Distance units for the request and for every distance shown.
   *
   * Default: `mi` when `config.unit` is `imperial`, `km` otherwise.
   */
  units?: RoutingUnits;

  /** Language of the turn-by-turn instructions. Defaults to the SDK's primary language. */
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
        /** Restricts results to these ISO 3166-1 alpha-2 country codes. */
        country?: readonly string[];
        /** Biases results towards the current map view. Default: `true` */
        proximity?: boolean;
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

  /** Text overrides, for localization. */
  labels?: RoutingControlLabels;

  /** Value-formatting overrides. */
  formatters?: RoutingControlFormatters;

  /** Theme values, written as CSS custom properties on the panel root. */
  theme?: RoutingControlTheme;

  /**
   * Arbitrary CSS custom properties set on the panel root, for anything
   * {@link RoutingControlTheme} does not cover. Keys are used verbatim and
   * must include the leading `--`.
   */
  cssVariables?: Record<string, string>;

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
