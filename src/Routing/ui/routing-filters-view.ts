import { supportsAvoidances, supportsRouteMode } from "../routing-constants";
import type { CarRouteMode, RoutingAvoidances, RoutingProfile, RoutingUnits } from "../types";
import type { RoutingPanelContext } from "./routing-ui-context";
import { PROFILE_ICONS, RC } from "./routing-ui-defaults";
import { button, el, icon, setBooleanAttribute } from "./routing-ui-dom";

/**
 * The transport switcher and the filter row.
 *
 * Native form controls are used throughout — a `select` for the route
 * preference, `datetime-local` for the departure, checkboxes for the
 * avoidances. They are keyboard accessible and localized by the browser, and
 * they are styleable through the same custom properties as the rest of the
 * panel.
 */
export class FiltersView {
  /** Root element of the view. */
  readonly element: HTMLElement;

  private readonly context: RoutingPanelContext;
  private readonly modesElement: HTMLElement;
  private readonly filtersElement: HTMLElement;

  /** Avoidances are held here because the API only receives the ones switched on. */
  private avoidances: RoutingAvoidances = {};
  private routeMode: CarRouteMode = "fastest";

  constructor(context: RoutingPanelContext) {
    this.context = context;

    this.element = el("div");
    this.modesElement = el("div", RC.modes);
    this.modesElement.setAttribute("role", "radiogroup");
    this.modesElement.setAttribute("aria-label", context.options.labels.transportMode);

    this.filtersElement = el("div", RC.filters);
    this.element.append(this.modesElement, this.filtersElement);
  }

  //#region Transport modes

  /** Renders the transport tabs and the filters that apply to the current profile. */
  render(): void {
    this.renderModes();
    this.renderFilters();
  }

  private renderModes(): void {
    const { modes, labels, renderers, formatters } = this.context.options;
    const selected = this.context.routing.getProfile();

    const replacement = renderers.transportModes?.({ modes, selected, control: this.context.control, labels, formatters });
    if (replacement) {
      this.modesElement.replaceChildren(replacement);
      return;
    }

    // an empty list pins the profile: the switcher disappears entirely
    if (modes.length === 0) {
      this.modesElement.replaceChildren();
      this.modesElement.hidden = true;
      return;
    }

    this.modesElement.hidden = false;
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

      if (typeof mode.icon === "function") tab.append(mode.icon());
      else tab.append(icon(mode.icon ?? PROFILE_ICONS[mode.id]));

      tab.append(el("span", undefined, mode.label ?? labels.modes[mode.id] ?? mode.id));

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
    const { filters } = this.context.options;
    const profile = this.context.routing.getProfile();
    const fragment = document.createDocumentFragment();

    for (const filter of filters) {
      // sections that cannot apply to this profile hide themselves, so a
      // consumer never has to re-configure the panel on a profile switch
      if (filter === "mode" && !supportsRouteMode(profile)) continue;
      if (filter === "avoidances" && !supportsAvoidances(profile)) continue;

      if (filter === "mode") fragment.append(this.buildRouteModeFilter());
      else if (filter === "departure") fragment.append(this.buildDepartureFilter());
      else if (filter === "avoidances") fragment.append(this.buildAvoidancesFilter());
      else fragment.append(this.buildUnitsFilter());
    }

    this.filtersElement.replaceChildren(fragment);
    this.filtersElement.hidden = filters.length === 0;
  }

  private buildRouteModeFilter(): HTMLElement {
    const { labels } = this.context.options;
    const wrapper = el("div", RC.filter);
    wrapper.dataset.filter = "mode";

    const select = el("select", RC.select);
    select.setAttribute("aria-label", labels.routes);

    for (const mode of ["fastest", "shortest", "balanced"] as const) {
      const option = el("option", undefined, labels.routeModes[mode] ?? mode);
      option.value = mode;
      option.selected = mode === this.routeMode;
      select.append(option);
    }

    select.addEventListener("change", () => {
      this.routeMode = select.value as CarRouteMode;
      this.pushProfileOptions();
    });

    wrapper.append(select);
    return wrapper;
  }

  private buildDepartureFilter(): HTMLElement {
    const { labels } = this.context.options;
    const wrapper = el("div", RC.filter);
    wrapper.dataset.filter = "departure";

    const input = el("input", RC.select);
    input.type = "datetime-local";
    input.setAttribute("aria-label", labels.departure);
    input.title = labels.departure;

    input.addEventListener("change", () => {
      // an empty field means "leave now", which the API expresses by omitting
      // the departure entirely
      this.context.routing.setDepartureTime(input.value ? input.value : null);
    });

    wrapper.append(input);
    return wrapper;
  }

  private buildAvoidancesFilter(): HTMLElement {
    const { avoidances, labels } = this.context.options;
    const wrapper = el("div", RC.filter);
    wrapper.dataset.filter = "avoidances";

    const group = el("fieldset", RC.switchRow);
    const legend = el("legend", RC.filterLabel, labels.avoid);
    group.append(legend);

    for (const id of avoidances) {
      const label = el("label");
      const checkbox = el("input");
      checkbox.type = "checkbox";
      checkbox.checked = this.avoidances[id] === true;

      checkbox.addEventListener("change", () => {
        this.avoidances = { ...this.avoidances, [id]: checkbox.checked };
        this.pushProfileOptions();
      });

      label.append(checkbox, el("span", undefined, labels.avoidances[id] ?? id));
      group.append(label);
    }

    wrapper.append(group);
    return wrapper;
  }

  private buildUnitsFilter(): HTMLElement {
    const { labels } = this.context.options;
    const wrapper = el("div", RC.filter);
    wrapper.dataset.filter = "units";

    const group = el("div", RC.units);
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", labels.units);

    for (const unit of ["km", "mi"] as const) {
      const option = button(RC.unit, unit);
      option.dataset.units = unit;
      option.setAttribute("role", "radio");
      const isSelected = this.context.routing.getUnits() === unit;
      setBooleanAttribute(option, "aria-checked", isSelected);
      option.tabIndex = isSelected ? 0 : -1;

      option.addEventListener("click", () => {
        this.context.routing.setUnits(unit as RoutingUnits);
      });

      group.append(option);
    }

    wrapper.append(group);
    return wrapper;
  }

  /**
   * Pushes the filter state into the session.
   *
   * The profile options are overwritten rather than merged, and the session
   * drops the keys that do not apply to the current profile when it builds the
   * request.
   */
  private pushProfileOptions(): void {
    const profile = this.context.routing.getProfile();

    this.context.routing.setProfileOptions({
      ...(supportsRouteMode(profile) ? { mode: this.routeMode } : {}),
      ...(supportsAvoidances(profile) ? { avoidances: this.avoidances } : {}),
    });
  }

  //#endregion
}
