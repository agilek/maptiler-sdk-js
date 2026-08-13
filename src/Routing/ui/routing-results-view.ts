import type { Route } from "../types";
import type { RoutingPanelContext } from "./routing-ui-context";
import { RC, maneuverIconId } from "./routing-ui-defaults";
import { button, el, icon, setBooleanAttribute, setDataFlag } from "./routing-ui-dom";
import type { RoutingPanelStatus } from "./routing-ui-types";

/**
 * The results half of the panel: the status line, the route cards, and the
 * turn-by-turn view a card opens.
 *
 * The two views live side by side and are toggled with `hidden`, so the
 * detail list keeps its scroll position when the user goes back and forth.
 */
export class ResultsView {
  /** Root element of the view. */
  readonly element: HTMLElement;

  private readonly context: RoutingPanelContext;
  private readonly statusElement: HTMLParagraphElement;
  private readonly errorElement: HTMLParagraphElement;
  private readonly skeleton: HTMLElement;
  private readonly routesHeader: HTMLElement;
  private readonly routesList: HTMLUListElement;
  private readonly detailElement: HTMLElement;
  private readonly detailSummary: HTMLParagraphElement;
  private readonly stepsList: HTMLOListElement;

  private status: RoutingPanelStatus = "idle";
  private error: Error | null = null;

  /** The card that opened the detail view, so focus can be returned to it. */
  private detailOpener: HTMLElement | null = null;

  constructor(context: RoutingPanelContext) {
    this.context = context;
    const { labels } = context.options;

    this.statusElement = el("p", RC.status);
    this.statusElement.setAttribute("role", "status");
    this.statusElement.setAttribute("aria-live", "polite");

    this.errorElement = el("p", RC.error);
    this.errorElement.setAttribute("role", "alert");
    this.errorElement.hidden = true;

    // RouteLoading: one placeholder per card the request is expected to return,
    // shown in place of the status line while the first result is on its way
    this.skeleton = el("div", RC.skeleton);
    this.skeleton.setAttribute("aria-hidden", "true");
    this.skeleton.hidden = true;
    for (let index = 0; index < Math.min(context.options.alternates + 1, 3); index++) {
      this.skeleton.append(el("div", RC.skeletonCard));
    }

    this.routesHeader = el("div", RC.routesHeader);
    this.routesHeader.append(el("h3", undefined, labels.routes));
    this.routesHeader.hidden = true;

    this.routesList = el("ul", RC.routes);
    this.routesList.setAttribute("role", "list");

    this.detailSummary = el("p", RC.detailSummary);
    this.stepsList = el("ol", RC.steps);

    const detailTop = el("div", RC.detailTop);
    const back = button(RC.detailBack, labels.backToRoutes, "chevron-left");
    back.addEventListener("click", () => {
      this.showRoutes();
    });
    detailTop.append(back);

    this.detailElement = el("div", RC.view);
    this.detailElement.dataset.view = "detail";
    this.detailElement.hidden = true;
    this.detailElement.append(detailTop, this.detailSummary, this.stepsList);

    this.element = el("div");
    this.element.append(this.statusElement, this.errorElement, this.skeleton, this.routesHeader, this.routesList, this.detailElement);
  }

  //#region State

  /** Records the panel status, which drives the status line and the busy flag. */
  setStatus(status: RoutingPanelStatus, error: Error | null = null): void {
    this.status = status;
    this.error = error;
  }

  /** The current status, so the control can mirror it onto the panel root. */
  getStatus(): RoutingPanelStatus {
    return this.status;
  }

  //#endregion

  //#region Rendering

  /** Renders the status line, the cards and — when open — the step list. */
  render(): void {
    this.renderStatus();
    this.renderRoutes();
    if (!this.detailElement.hidden) this.renderSteps();
  }

  private renderStatus(): void {
    const { labels, renderers, formatters } = this.context.options;
    const routes = this.context.routing.getRoutes();

    const replacement = renderers.status?.({ status: this.status, error: this.error, control: this.context.control, labels, formatters });
    if (replacement) {
      this.statusElement.replaceChildren(replacement);
      this.errorElement.hidden = true;
      return;
    }

    this.errorElement.hidden = this.status !== "error";
    if (this.status === "error") this.errorElement.textContent = this.error?.message ?? labels.error;

    const text =
      this.status === "loading" && routes.length === 0 ? labels.loading : this.status === "empty" ? labels.noRoutes : this.status === "idle" ? labels.needsWaypoints : "";

    // the skeleton stands in for the first result, so the "Calculating route…"
    // line is clipped rather than removed: it is the live region that tells a
    // screen reader what the placeholders mean
    const skeletonShowing = this.status === "loading" && routes.length === 0 && !this.isDetailOpen();
    this.skeleton.hidden = !skeletonShowing;
    setDataFlag(this.statusElement, "silent", skeletonShowing);

    this.statusElement.textContent = text;
    this.statusElement.hidden = text === "" || this.isDetailOpen();

    // stale results stay on screen while a new request runs, so the list is
    // marked busy rather than emptied
    setBooleanAttribute(this.routesList, "aria-busy", this.status === "loading" && routes.length > 0);
    // while the turn-by-turn view is open the list belongs to it, so a render
    // triggered by anything else must not bring the list chrome back
    this.routesHeader.hidden = routes.length === 0 || this.isDetailOpen();
    const heading = this.routesHeader.querySelector("h3");
    if (heading) heading.textContent = this.status === "loading" && routes.length > 0 ? labels.recalculating : labels.routes;
  }

  private renderRoutes(): void {
    const { renderers, labels, formatters, turnByTurn } = this.context.options;
    const routes = this.context.routing.getRoutes();
    const selectedIndex = this.context.routing.getSelectedIndex();
    const fragment = document.createDocumentFragment();

    routes.forEach((route, index) => {
      const selected = index === selectedIndex;

      const replacement = renderers.routeCard?.({ route, index, selected, control: this.context.control, labels, formatters });
      if (replacement) {
        fragment.append(replacement);
        return;
      }

      const card = el("li", RC.routeCard);
      card.dataset.index = index.toString();
      setDataFlag(card, "selected", selected);

      const body = el("button", RC.routeBody);
      body.type = "button";
      setBooleanAttribute(body, "aria-pressed", selected);
      body.append(
        el("span", RC.routeDuration, formatters.duration(route.summary.totalTime)),
        this.renderRouteMeta(route),
        el("span", RC.routeDescription, formatters.routeDescription(route.summary)),
      );
      body.addEventListener("click", () => {
        this.context.routing.selectRoute(index);
      });
      card.append(body);

      if (turnByTurn.enabled) {
        // RouteOptions: a 32px bordered square carrying the RoutingStart icon,
        // the same one the launcher uses
        const detail = button(RC.routeDetail, labels.showDetail, "route-start");
        detail.addEventListener("click", () => {
          this.context.routing.selectRoute(index);
          this.showDetail(detail);
        });
        // a nested button would be invalid HTML and would swallow this click,
        // so the detail affordance is a sibling of the card body
        card.append(detail);
      }

      fragment.append(card);
    });

    this.routesList.replaceChildren(fragment);
    this.routesList.hidden = this.isDetailOpen();
  }

  /**
   * The middle line of a card: arrival time and distance, each behind its own
   * icon, as two groups rather than one dot-separated sentence.
   */
  private renderRouteMeta(route: Route): HTMLElement {
    const { formatters, labels } = this.context.options;
    const units = this.context.routing.getUnits();

    const arrival = el("span", RC.routeMetaItem);
    arrival.append(icon("clock"), el("span", undefined, `${formatters.arrival(route.summary.totalTime)} ${labels.eta}`));

    const distance = el("span", RC.routeMetaItem);
    distance.append(icon("path"), el("span", undefined, formatters.distance(route.summary.totalLength, units)));

    const meta = el("span", RC.routeMeta);
    meta.append(arrival, distance);
    return meta;
  }

  private renderSteps(): void {
    const { labels, formatters, renderers, turnByTurn } = this.context.options;
    const route = this.context.routing.getSelectedRoute();
    const steps = this.context.routing.getSteps();
    const units = this.context.routing.getUnits();

    this.detailSummary.textContent = route ? `${formatters.duration(route.summary.totalTime)} · ${formatters.distance(route.summary.totalLength, units)}` : "";

    if (steps.length === 0) {
      this.stepsList.replaceChildren(el("li", RC.step, labels.noSteps));
      return;
    }

    const fragment = document.createDocumentFragment();

    steps.forEach((entry, index) => {
      const replacement = renderers.step?.({ entry, index, control: this.context.control, labels, formatters });
      if (replacement) {
        fragment.append(replacement);
        return;
      }

      const item = el("li");
      const stepButton = el("button", RC.step);
      stepButton.type = "button";
      stepButton.dataset.leg = entry.legIndex.toString();
      stepButton.dataset.step = entry.stepIndex.toString();

      const instruction = entry.step.maneuver?.instruction ?? entry.step.streetName ?? "Continue";
      const distance = formatters.distance(entry.step.length, units);

      const stepIcon = icon(maneuverIconId(entry.step.maneuver?.type), entry.step.maneuver?.type);
      stepIcon.classList.add(RC.stepIcon);

      stepButton.append(stepIcon, el("span", RC.stepText, instruction), el("span", RC.stepDistance, distance));
      // the visible text is split across two spans, so the button gets its own
      // accessible name
      stepButton.setAttribute("aria-label", `${instruction}, ${distance}`);

      if (turnByTurn.zoomOnStepClick) {
        stepButton.addEventListener("click", () => {
          this.context.routing.zoomToStep(entry, { maxZoom: turnByTurn.maxZoom });
          this.context.control.fire("routinguistepclick", { entry });
        });
      }

      item.append(stepButton);
      fragment.append(item);
    });

    this.stepsList.replaceChildren(fragment);
  }

  //#endregion

  //#region Views

  /** Opens the turn-by-turn view for the selected route. */
  showDetail(opener?: HTMLElement): void {
    this.detailOpener = opener ?? null;
    this.detailElement.hidden = false;
    this.routesHeader.hidden = true;
    this.routesList.hidden = true;
    this.statusElement.hidden = true;
    this.skeleton.hidden = true;
    this.renderSteps();
    this.detailElement.querySelector<HTMLButtonElement>(`.${RC.detailBack}`)?.focus();
    this.context.control.fire("routinguiviewchange", { view: "detail" });
  }

  /** Returns to the route list, restoring focus to whatever opened the detail. */
  showRoutes(): void {
    this.detailElement.hidden = true;
    this.routesList.hidden = false;
    this.render();
    this.detailOpener?.focus();
    this.detailOpener = null;
    this.context.control.fire("routinguiviewchange", { view: "list" });
  }

  /** `true` while the turn-by-turn view is open. */
  isDetailOpen(): boolean {
    return !this.detailElement.hidden;
  }

  //#endregion
}
