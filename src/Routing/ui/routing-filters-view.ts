import { supportsAvoidances, supportsBicycleType, supportsRouteMode, supportsTravelSpeed, supportsVehicleOptions } from "../routing-constants";
import type { BicycleRouteType, CarRouteMode, RoutingAvoidances, RoutingProfile, RoutingUnits } from "../types";
import { Dropdown, choiceRow, menuNote, menuRow, numberField, switchField } from "./routing-dropdown";
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
  private travelSpeed: number | undefined = undefined;

  /** Live dropdowns, kept so their document listeners can be dropped. */
  private dropdowns: Dropdown[] = [];

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
    const dropdown = new Dropdown(label, ariaLabel);
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
   * Departure: "Now", or a moment picked in the field the menu holds.
   *
   * The two are one control rather than two filters — the field's own empty
   * state is what "now" means to the API, so clearing it and choosing "Now" are
   * the same action.
   */
  private buildDepartureFilter(): HTMLElement {
    const { labels } = this.context.options;
    const dropdown = this.createDropdown("departure", labels.departNow, labels.departure);

    const input = el("input", RC.dropdownDate);
    input.type = "datetime-local";
    input.setAttribute("aria-label", labels.departure);

    const now = el("input");
    now.type = "radio";
    now.name = `maptiler-routing-departure-${(++groupSequence).toString()}`;
    now.checked = true;
    now.addEventListener("change", () => {
      input.value = "";
      dropdown.setLabel(labels.departNow);
      dropdown.close();
      this.context.routing.setDepartureTime(null);
    });

    input.addEventListener("change", () => {
      now.checked = input.value === "";
      dropdown.setLabel(input.value === "" ? labels.departNow : input.value.replace("T", " "));
      this.context.routing.setDepartureTime(input.value ? input.value : null);
    });

    dropdown.menu.append(menuRow(labels.departNow, now), menuRow(labels.departure, input));
    return dropdown.element;
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
    const rowLabel = this.context.routing.getProfile() === "bicycle" ? labels.cyclingSpeed : labels.walkingSpeed;

    const input = numberField(this.travelSpeed, labels.speedUnit, 1, 1, (value) => {
      this.travelSpeed = value;
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
   * Pushes the filter state into the session.
   *
   * The profile options are overwritten rather than merged, and the session
   * drops the keys that do not apply to the current profile when it builds the
   * request.
   */
  private pushProfileOptions(): void {
    // built per profile rather than merged from parts: the option shapes block
    // each other's keys, so one object carrying both a `mode` and a
    // `cyclingSpeed` matches none of them
    switch (this.context.routing.getProfile()) {
      case "car":
        this.context.routing.setProfileOptions({ mode: this.routeMode, avoidances: this.avoidances });
        return;
      case "truck":
        this.context.routing.setProfileOptions({ ...this.vehicle, avoidances: this.avoidances });
        return;
      case "bicycle":
        this.context.routing.setProfileOptions({ type: this.bicycleType, cyclingSpeed: this.travelSpeed });
        return;
      default:
        this.context.routing.setProfileOptions({ walkingSpeed: this.travelSpeed });
    }
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
