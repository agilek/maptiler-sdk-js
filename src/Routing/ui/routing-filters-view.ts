import { supportsAvoidances, supportsBicycleType, supportsRouteMode, supportsTravelSpeed, supportsVehicleOptions } from "../routing-constants";
import type { BicycleRouteType, CarRouteMode, RoutingAvoidances, RoutingProfile, RoutingProfileOptions, RoutingUnits } from "../types";
import { Dropdown, choiceRow, menuNote, menuRow, numberField, stepperRow, switchField } from "./routing-dropdown";
import type { RoutingPanelContext } from "./routing-ui-context";
import { PROFILE_ICONS, RC } from "./routing-ui-defaults";
import { el, icon, setBooleanAttribute } from "./routing-ui-dom";

/**
 * Vehicle fields the truck menu offers, in the design's order, each with the
 * unit it is expressed in and the step its entry moves by.
 */
const VEHICLE_FIELDS = [
  { id: "height", unit: "m", step: 0.1 },
  { id: "length", unit: "m", step: 0.1 },
  { id: "weight", unit: "t", step: 0.1 },
  { id: "axleLoad", unit: "t", step: 0.1 },
  { id: "topSpeed", unit: "km/h", step: 1 },
] as const;

/** Bicycle sub-types the bicycle menu offers, in the design's order. */
const BICYCLE_TYPES: readonly BicycleRouteType[] = ["road", "gravel", "mountain", "city"];

/** Makes each menu's radio group unique, so two panels never share one. */
let groupSequence = 0;

/** How far one press of the time row moves the departure, in minutes. */
const DEPARTURE_STEP_MINUTES = 15;

const MINUTES_PER_DAY = 24 * 60;

/** Midnight of the day a moment falls in, for counting whole days between two. */
function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/** The next whole step at or after a moment. */
function roundUpToStep(value: Date, stepMinutes: number): Date {
  const step = stepMinutes * 60_000;
  return new Date(Math.ceil(value.getTime() / step) * step);
}

/**
 * A local `YYYY-MM-DDTHH:mm` stamp.
 *
 * `toISOString` would convert to UTC, and the service reads the departure in
 * the route's own timezone — 18:30 has to stay 18:30.
 */
function toLocalISOString(value: Date): string {
  const pad = (part: number) => part.toString().padStart(2, "0");
  return `${value.getFullYear().toString()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

/**
 * Takes a section out of the layout, leaving its placeholder behind so it can
 * be put back in the same position.
 *
 * @remarks
 * These check for a parent rather than `isConnected`: the first render happens
 * inside `onAdd`, before MapLibre has put the panel in the document, so
 * `isConnected` is still `false` for everything and a swap would be skipped.
 */
function hide(element: HTMLElement, placeholder: Comment): void {
  if (!element.parentNode) return;
  element.replaceWith(placeholder);
}

/** Puts a section back where its placeholder is sitting. */
function show(element: HTMLElement, placeholder: Comment): void {
  if (element.parentNode || !placeholder.parentNode) return;
  placeholder.replaceWith(element);
}

/**
 * The transport switcher and the filter row.
 *
 * The row is the design's RouteFilters: a line of pills, each showing its
 * current value and opening a small menu. Which pills appear is decided by the
 * profile — the route preference belongs to the car, the vehicle menu to the
 * truck, the bicycle type and the speed to the bicycle and the pedestrian — so
 * switching transport mode rewrites the row rather than greying parts of it
 * out.
 *
 * Inside the menus the controls stay native — radios, checkboxes, number
 * fields, `datetime-local` — so they remain keyboard accessible and localized
 * by the browser.
 */
export class FiltersView {
  /**
   * The transport switcher, and the filter row.
   *
   * They are two separate roots rather than one wrapper because the design
   * puts the waypoint inputs between them: switcher, inputs, filters, results.
   * The control places each where it belongs.
   */
  readonly modesElement: HTMLElement;
  readonly filtersElement: HTMLElement;

  private readonly context: RoutingPanelContext;

  /**
   * Stand-ins left in the DOM when a section is removed, so it can be put back
   * in the right place later. A section is removed rather than hidden — an
   * empty flex row would still paint its background and margin.
   */
  private readonly modesPlaceholder = document.createComment("maptiler-routing-modes");
  private readonly filtersPlaceholder = document.createComment("maptiler-routing-filters");

  /** Avoidances are held here because the API only receives the ones switched on. */
  private avoidances: RoutingAvoidances = {};
  private routeMode: CarRouteMode = "fastest";
  private vehicle: { weight?: number; height?: number; length?: number; axleLoad?: number; topSpeed?: number; hazmat?: boolean } = {};
  private bicycleType: BicycleRouteType | undefined = undefined;

  /**
   * The pace filter's value, remembered per profile.
   *
   * One field between the two would make a 22 km/h bicycle into a 22 km/h
   * walk on the first switch — and now that a switch re-sends the row's values
   * (see {@link FiltersView.syncProfileOptions}), it would be asked for rather
   * than merely displayed.
   */
  private cyclingSpeed: number | undefined = undefined;
  private walkingSpeed: number | undefined = undefined;

  /** Departure moment, or `null` for leaving now. */
  private departure: Date | null = null;

  /** Redraws the departure menu after a step. Set while that menu exists. */
  private refreshDeparture?: () => void;

  /** Live dropdowns, kept so their document listeners can be dropped. */
  private dropdowns: Dropdown[] = [];

  /**
   * `false` until the row has been built once.
   *
   * The session's options are adopted on that first pass rather than in the
   * constructor: the panel may still move the session onto another profile
   * between the two (see `alignProfileWithModes`), and what is adopted has to
   * be the options of the profile the row is actually about to draw.
   */
  private hydrated = false;

  constructor(context: RoutingPanelContext) {
    this.context = context;

    this.modesElement = el("div", RC.modes);
    this.modesElement.setAttribute("role", "radiogroup");
    this.modesElement.setAttribute("aria-label", context.options.labels.transportMode);

    this.filtersElement = el("div", RC.filters);
  }

  //#region Transport modes

  /** Renders the transport tabs and the filters that apply to the current profile. */
  render(): void {
    this.renderModes();
    this.renderFilters();
  }

  /**
   * Whether the switcher is worth rendering at all.
   *
   * When it is not, the container is removed rather than emptied or hidden:
   * an empty rail would still paint its background, border and margin.
   */
  private shouldRenderModes(): boolean {
    const { modes, modeDisplay, showSingleMode } = this.context.options;

    if (modes.length === 0) return false;
    if (modeDisplay === "none") return false;
    // one mode is a label, not a control — the consumer decides whether it earns the space
    if (modes.length === 1 && !showSingleMode) return false;
    return true;
  }

  private renderModes(): void {
    const { modes, labels, renderers, formatters, modeDisplay } = this.context.options;
    const selected = this.context.routing.getProfile();

    const replacement = renderers.transportModes?.({ modes, selected, control: this.context.control, labels, formatters });
    if (replacement) {
      show(this.modesElement, this.modesPlaceholder);
      this.modesElement.replaceChildren(replacement);
      return;
    }

    if (!this.shouldRenderModes()) {
      this.modesElement.replaceChildren();
      hide(this.modesElement, this.modesPlaceholder);
      return;
    }

    show(this.modesElement, this.modesPlaceholder);
    const fragment = document.createDocumentFragment();

    for (const mode of modes) {
      const isSelected = mode.id === selected;
      const tab = el("button", mode.className ? `${RC.mode} ${mode.className}` : RC.mode);
      tab.type = "button";
      tab.dataset.mode = mode.id;
      tab.setAttribute("role", "radio");
      setBooleanAttribute(tab, "aria-checked", isSelected);
      // roving tabindex: the group is one stop, arrows move within it
      tab.tabIndex = isSelected ? 0 : -1;

      if (modeDisplay !== "label") {
        if (typeof mode.icon === "function") tab.append(mode.icon());
        else tab.append(icon(mode.icon ?? PROFILE_ICONS[mode.id]));
      }

      const name = mode.label ?? labels.modes[mode.id] ?? mode.id;
      if (modeDisplay === "icon") {
        // icon-only, but the name still names the tab for assistive tech
        tab.setAttribute("aria-label", name);
        tab.title = name;
      } else {
        tab.append(el("span", undefined, name));
      }

      tab.addEventListener("click", () => {
        this.context.routing.setProfile(mode.id);
      });

      tab.addEventListener("keydown", (event) => {
        this.handleModeKeydown(event, mode.id);
      });

      fragment.append(tab);
    }

    this.modesElement.replaceChildren(fragment);
  }

  /** Arrow keys move the selection, which is the radio-group convention. */
  private handleModeKeydown(event: KeyboardEvent, current: RoutingProfile): void {
    const { modes } = this.context.options;
    const index = modes.findIndex((mode) => mode.id === current);
    if (index === -1) return;

    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % modes.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + modes.length) % modes.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = modes.length - 1;
    else return;

    event.preventDefault();
    this.context.routing.setProfile(modes[next].id);
    // the re-render replaces the buttons, so focus is restored afterwards
    requestAnimationFrame(() => {
      this.modesElement.querySelector<HTMLButtonElement>(`[data-mode="${modes[next].id}"]`)?.focus();
    });
  }

  //#endregion

  //#region Filters

  private renderFilters(): void {
    const { filters, unitsSwitchable } = this.context.options;
    const profile = this.context.routing.getProfile();

    if (!this.hydrated) {
      this.hydrated = true;
      // the session outlives any single panel and may already carry options —
      // set programmatically, or left by a panel that was removed and re-added
      this.adoptSessionOptions();
      // and what the pills show that the session does not hold yet — the route
      // preference, which is drawn as "Fastest" from the first render — is sent
      // rather than only displayed
      this.pushProfileOptions();
    }
    const fragment = document.createDocumentFragment();

    // the row is rebuilt from scratch, so the previous dropdowns' document
    // listeners have to go with them
    for (const dropdown of this.dropdowns) dropdown.destroy();
    this.dropdowns = [];

    for (const filter of filters) {
      // sections that cannot apply to this profile hide themselves, so a
      // consumer never has to re-configure the panel on a profile switch
      if (filter === "mode" && !supportsRouteMode(profile)) continue;
      if (filter === "avoidances" && !supportsAvoidances(profile)) continue;
      if (filter === "vehicle" && !supportsVehicleOptions(profile)) continue;
      if (filter === "bicycleType" && !supportsBicycleType(profile)) continue;
      if (filter === "speed" && !supportsTravelSpeed(profile)) continue;
      // a fixed unit has nothing to toggle
      if (filter === "units" && !unitsSwitchable) continue;

      if (filter === "mode") fragment.append(this.buildRouteModeFilter());
      else if (filter === "departure") fragment.append(this.buildDepartureFilter());
      else if (filter === "avoidances") fragment.append(this.buildAvoidancesFilter());
      else if (filter === "vehicle") fragment.append(this.buildVehicleFilter());
      else if (filter === "bicycleType") fragment.append(this.buildBicycleTypeFilter());
      else if (filter === "speed") fragment.append(this.buildSpeedFilter());
      else fragment.append(this.buildUnitsFilter());
    }

    // removed rather than hidden: an empty flex row would still paint its
    // border and margin (`display` in the stylesheet beats the `hidden`
    // attribute, which is a UA-stylesheet rule)
    if (fragment.childNodes.length === 0) {
      this.filtersElement.replaceChildren();
      hide(this.filtersElement, this.filtersPlaceholder);
      return;
    }

    show(this.filtersElement, this.filtersPlaceholder);
    this.filtersElement.replaceChildren(fragment);
  }

  /**
   * Creates a dropdown, registers it for teardown and tags it with its filter
   * id so a consumer's stylesheet can reach one in particular.
   */
  private createDropdown(filter: string, label: string, ariaLabel: string): Dropdown {
    const dropdown = Dropdown.pill(label, ariaLabel);
    dropdown.element.dataset.filter = filter;
    this.dropdowns.push(dropdown);
    return dropdown;
  }

  /**
   * A menu of mutually exclusive values, which is what most of the filters are.
   *
   * The pill shows the chosen value and the menu holds one radio per option, so
   * the closed state answers "which one?" without being opened.
   */
  private buildChoiceFilter<T extends string>(
    filter: string,
    ariaLabel: string,
    values: readonly T[],
    labelOf: (value: T) => string,
    isSelected: (value: T) => boolean,
    onPick: (value: T) => void,
  ): HTMLElement {
    const current = values.find((value) => isSelected(value));
    const dropdown = this.createDropdown(filter, current ? labelOf(current) : ariaLabel, ariaLabel);
    const name = `maptiler-routing-${filter}-${(++groupSequence).toString()}`;

    for (const value of values) {
      const radio = el("input");
      radio.type = "radio";
      radio.name = name;
      radio.checked = isSelected(value);
      radio.addEventListener("change", () => {
        dropdown.setLabel(labelOf(value));
        dropdown.close();
        onPick(value);
      });

      dropdown.menu.append(choiceRow(labelOf(value), radio, isSelected(value)));
    }

    return dropdown.element;
  }

  private buildRouteModeFilter(): HTMLElement {
    const { labels } = this.context.options;

    return this.buildChoiceFilter(
      "mode",
      labels.routes,
      ["fastest", "shortest", "balanced"] as const,
      (mode) => labels.routeModes[mode] ?? mode,
      (mode) => mode === this.routeMode,
      (mode: CarRouteMode) => {
        this.routeMode = mode;
        this.pushProfileOptions();
      },
    );
  }

  /**
   * Departure: a day and a time, each stepped a notch at a time, plus the way
   * back to leaving now.
   *
   * The design (DropdownDeparture) has no calendar and no text entry: two rows
   * with a caret on each side, and "Now" underneath. Stepping is enough for
   * what this picker is for — a departure later today, or tomorrow morning —
   * and it needs no locale-specific parsing.
   */
  private buildDepartureFilter(): HTMLElement {
    const { labels } = this.context.options;
    const dropdown = this.createDropdown("departure", this.departureLabel(), labels.departure);

    const dayRow = stepperRow(
      "calendar",
      () => this.formatDepartureDay(),
      labels.previousDay,
      labels.nextDay,
      (direction) => {
        this.stepDeparture(direction * MINUTES_PER_DAY);
      },
      (direction) => this.canStepDeparture(direction * MINUTES_PER_DAY),
    );

    const timeRow = stepperRow(
      "clock",
      () => this.formatDepartureTime(),
      labels.earlier,
      labels.later,
      (direction) => {
        this.stepDeparture(direction * DEPARTURE_STEP_MINUTES);
      },
      (direction) => this.canStepDeparture(direction * DEPARTURE_STEP_MINUTES),
    );

    const now = el("button", RC.dropdownReset);
    now.type = "button";
    now.textContent = labels.departNow;
    now.addEventListener("click", () => {
      this.departure = null;
      dropdown.setLabel(labels.departNow);
      dropdown.close();
      this.context.routing.setDepartureTime(null);
    });

    this.refreshDeparture = () => {
      dayRow.refresh();
      timeRow.refresh();
      dropdown.setLabel(this.departureLabel());
    };

    dropdown.menu.append(dayRow.element, timeRow.element, now);
    this.refreshDeparture();
    return dropdown.element;
  }

  /**
   * Moves the departure by a number of minutes, starting from the next whole
   * step after now — so the first press on either row leaves the past behind
   * rather than proposing a departure that has already gone.
   */
  private stepDeparture(minutes: number): void {
    const base = this.departure ?? roundUpToStep(new Date(), DEPARTURE_STEP_MINUTES);
    const next = new Date(base.getTime() + minutes * 60_000);

    // a departure in the past is not a request the service can answer
    this.departure = next.getTime() < Date.now() ? roundUpToStep(new Date(), DEPARTURE_STEP_MINUTES) : next;

    this.refreshDeparture?.();
    this.context.routing.setDepartureTime(toLocalISOString(this.departure));
  }

  /** Whether a step of this many minutes would land in the past. */
  private canStepDeparture(minutes: number): boolean {
    if (minutes > 0) return true;
    const base = this.departure ?? roundUpToStep(new Date(), DEPARTURE_STEP_MINUTES);
    return base.getTime() + minutes * 60_000 >= Date.now();
  }

  /** The pill's text: "Now", or the day and time it is set to. */
  private departureLabel(): string {
    const { labels } = this.context.options;
    if (!this.departure) return labels.departNow;
    return `${this.formatDepartureDay()} ${this.formatDepartureTime()}`;
  }

  /** "Today", "Tomorrow", or a short date once it is further out. */
  private formatDepartureDay(): string {
    const { labels, language } = this.context.options;
    if (!this.departure) return labels.today;

    const days = Math.round((startOfDay(this.departure).getTime() - startOfDay(new Date()).getTime()) / (MINUTES_PER_DAY * 60_000));
    if (days === 0) return labels.today;
    if (days === 1) return labels.tomorrow;

    return this.departure.toLocaleDateString(language, { day: "numeric", month: "short" });
  }

  private formatDepartureTime(): string {
    const { language } = this.context.options;
    const value = this.departure ?? roundUpToStep(new Date(), DEPARTURE_STEP_MINUTES);
    return value.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
  }

  /** Avoidances: several switches at once, so the pill keeps its own name. */
  private buildAvoidancesFilter(): HTMLElement {
    const { avoidances, labels } = this.context.options;
    const dropdown = this.createDropdown("avoidances", labels.avoid, labels.avoid);

    for (const id of avoidances) {
      const toggle = switchField(this.avoidances[id] === true, (checked) => {
        this.avoidances = { ...this.avoidances, [id]: checked };
        this.pushProfileOptions();
      });

      dropdown.menu.append(menuRow(labels.avoidances[id] ?? id, toggle));
    }

    return dropdown.element;
  }

  /** Vehicle: the truck's dimensions and its hazardous-goods flag. */
  private buildVehicleFilter(): HTMLElement {
    const { labels } = this.context.options;
    const dropdown = this.createDropdown("vehicle", labels.vehicle, labels.vehicle);

    for (const field of VEHICLE_FIELDS) {
      const input = numberField(this.vehicle[field.id], field.unit, 0, field.step, (value) => {
        this.vehicle = { ...this.vehicle, [field.id]: value };
        this.pushProfileOptions();
      });

      dropdown.menu.append(menuRow(labels.vehicleFields[field.id] ?? field.id, input));
    }

    const hazmat = switchField(this.vehicle.hazmat === true, (checked) => {
      this.vehicle = { ...this.vehicle, hazmat: checked };
      this.pushProfileOptions();
    });

    dropdown.menu.append(menuRow(labels.vehicleFields.hazmat ?? "hazmat", hazmat));
    return dropdown.element;
  }

  private buildBicycleTypeFilter(): HTMLElement {
    const { labels } = this.context.options;

    return this.buildChoiceFilter(
      "bicycleType",
      labels.bicycleType,
      BICYCLE_TYPES,
      (type) => labels.bicycleTypes[type] ?? type,
      (type) => type === this.bicycleType,
      (type) => {
        this.bicycleType = type;
        this.pushProfileOptions();
      },
    );
  }

  /** Speed: cycling or walking, depending on the profile. Both are in km/h. */
  private buildSpeedFilter(): HTMLElement {
    const { labels } = this.context.options;
    const dropdown = this.createDropdown("speed", labels.speed, labels.speed);
    const cycling = this.context.routing.getProfile() === "bicycle";
    const rowLabel = cycling ? labels.cyclingSpeed : labels.walkingSpeed;

    const input = numberField(cycling ? this.cyclingSpeed : this.walkingSpeed, labels.speedUnit, 1, 1, (value) => {
      if (cycling) this.cyclingSpeed = value;
      else this.walkingSpeed = value;
      dropdown.setLabel(value === undefined ? labels.speed : `${value.toString()} ${labels.speedUnit}`);
      this.pushProfileOptions();
    });

    // the design spells out what the number does and does not affect
    dropdown.menu.append(menuRow(rowLabel, input), menuNote(labels.speedHint));
    return dropdown.element;
  }

  /** Units: only reachable when the developer opted into `units: "shown"`. */
  private buildUnitsFilter(): HTMLElement {
    const { labels } = this.context.options;

    return this.buildChoiceFilter(
      "units",
      labels.units,
      ["km", "mi"] as const,
      (unit) => unit,
      (unit) => unit === this.context.routing.getUnits(),
      (unit: RoutingUnits) => {
        this.context.routing.setUnits(unit);
      },
    );
  }

  /**
   * The filter state as the current profile's option object.
   *
   * Built per profile rather than merged from parts: the option shapes block
   * each other's keys, so one object carrying both a `mode` and a
   * `cyclingSpeed` matches none of them.
   */
  private profileOptions(): RoutingProfileOptions {
    switch (this.context.routing.getProfile()) {
      case "car":
        return { mode: this.routeMode, avoidances: this.avoidances };
      case "truck":
        return { ...this.vehicle, avoidances: this.avoidances };
      case "bicycle":
        return { type: this.bicycleType, cyclingSpeed: this.cyclingSpeed };
      default:
        return { walkingSpeed: this.walkingSpeed };
    }
  }

  /**
   * Takes the session's options for the current profile as the row's own.
   *
   * Without this a panel attached to a session that already carries options —
   * one set programmatically, or left behind by a panel that was removed and
   * re-added — would draw empty pills over them, and the first thing the user
   * touched would push those blanks back over what the session was routing
   * with.
   */
  private adoptSessionOptions(): void {
    const options = this.context.routing.getProfileOptions() as {
      mode?: CarRouteMode;
      avoidances?: RoutingAvoidances;
      weight?: number;
      height?: number;
      length?: number;
      axleLoad?: number;
      topSpeed?: number;
      hazmat?: boolean;
      type?: BicycleRouteType;
      cyclingSpeed?: number;
      walkingSpeed?: number;
    };

    switch (this.context.routing.getProfile()) {
      case "car":
        this.routeMode = options.mode ?? this.routeMode;
        this.avoidances = { ...options.avoidances };
        return;
      case "truck":
        this.vehicle = {
          weight: options.weight,
          height: options.height,
          length: options.length,
          axleLoad: options.axleLoad,
          topSpeed: options.topSpeed,
          hazmat: options.hazmat,
        };
        this.avoidances = { ...options.avoidances };
        return;
      case "bicycle":
        this.bicycleType = options.type ?? this.bicycleType;
        this.cyclingSpeed = options.cyclingSpeed ?? this.cyclingSpeed;
        return;
      default:
        this.walkingSpeed = options.walkingSpeed ?? this.walkingSpeed;
    }
  }

  /**
   * Pushes the filter state into the session.
   *
   * The profile options are overwritten rather than merged, and the session
   * drops the keys that do not apply to the current profile when it builds the
   * request.
   *
   * Silent when the session already holds what the row would send: every push
   * invalidates the route, and re-sending the same options would spend a
   * request on an answer that cannot differ.
   */
  private pushProfileOptions(): void {
    const next = this.profileOptions();
    if (optionsKey(next) === optionsKey(this.context.routing.getProfileOptions())) return;

    this.context.routing.setProfileOptions(next);
  }

  /**
   * Re-sends the filter state after the session moved to another profile.
   *
   * The session holds one option object, which belongs to the profile it was
   * set for; the row remembers a set per profile. Switching transport mode
   * therefore leaves the two disagreeing — the truck's pills would show the
   * dimensions the user entered while the request, still carrying the car's
   * object, asked for a truck route without them. This puts the row's own
   * values back on the session, so what is drawn is what is asked for.
   */
  syncProfileOptions(): void {
    this.pushProfileOptions();
  }

  /** Closes every open menu. Called when the map moves under the panel. */
  closeMenus(): void {
    for (const dropdown of this.dropdowns) dropdown.close();
  }

  /** Drops the dropdowns' document listeners. Called when the control is removed. */
  destroy(): void {
    for (const dropdown of this.dropdowns) dropdown.destroy();
    this.dropdowns = [];
  }

  //#endregion
}

/**
 * A comparable key for an options object.
 *
 * Order-independent and blind to unset keys, so two objects that build the
 * same request compare equal however they were assembled — `avoidances` is
 * nested, which is why this recurses rather than comparing one level.
 */
function optionsKey(options: object): string {
  const entries: [string, unknown][] = Object.entries(options)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, value !== null && typeof value === "object" ? optionsKey(value as object) : value]);

  return JSON.stringify(entries);
}
