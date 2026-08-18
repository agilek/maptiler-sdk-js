import { NOT_FOUND_REASONS, classifyRoutingError } from "../routing-errors";
import { routeToGpx } from "../routing-export";
import type { FlatRouteStep } from "../routing-steps";
import type { Route } from "../types";
import { Dropdown, menuButton } from "./routing-dropdown";
import { printRouteGuide } from "./routing-print";
import type { RoutingPanelContext } from "./routing-ui-context";
import { RC, maneuverIconId } from "./routing-ui-defaults";
import { button, downloadText, el, focusQuietly, icon, setBooleanAttribute, setDataFlag } from "./routing-ui-dom";
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
  private readonly routesList: HTMLUListElement;
  private readonly detailElement: HTMLElement;
  private readonly stepsList: HTMLOListElement;

  private status: RoutingPanelStatus = "idle";
  private error: Error | null = null;

  /** The card that opened the detail view, so focus can be returned to it. */
  private detailOpener: HTMLElement | null = null;

  /**
   * The step the user last clicked.
   *
   * Held here rather than read off the DOM: the list is rebuilt on every
   * render, and the row the map is showing should still be the marked one
   * afterwards. It is also where the dot returns to when the pointer leaves a
   * row it was only passing over.
   */
  private activeStep: FlatRouteStep | null = null;

  /**
   * The "no routes found" state: the drawing, the heading and the hint.
   *
   * A dead end is the one status worth more than a line of grey text — it is
   * where the visitor is stuck, and the hint is what unsticks them — so it takes
   * the place the cards would have had (RoutingPanel/not-found).
   */
  private readonly emptyElement: HTMLElement;
  private readonly emptyTitle: HTMLElement;
  private readonly emptyHint: HTMLElement;

  constructor(context: RoutingPanelContext) {
    this.context = context;
    const { labels } = context.options;

    this.statusElement = el("p", RC.status);
    this.statusElement.setAttribute("role", "status");
    this.statusElement.setAttribute("aria-live", "polite");

    const art = el("span", RC.emptyArt);
    art.setAttribute("aria-hidden", "true");
    this.emptyTitle = el("p", RC.emptyTitle, labels.noRoutes);
    this.emptyHint = el("p", RC.emptyHint, labels.noRoutesHint);

    this.emptyElement = el("div", RC.empty);
    // its own live region: the status line goes quiet for this state, so the
    // words are announced once rather than twice
    this.emptyElement.setAttribute("role", "status");
    this.emptyElement.setAttribute("aria-live", "polite");
    this.emptyElement.hidden = true;
    this.emptyElement.append(art, this.emptyTitle, this.emptyHint);

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

    this.routesList = el("ul", RC.routes);
    this.routesList.setAttribute("role", "list");
    // the design gives the list no heading, so its name lives on the list
    // itself rather than in a line above it
    this.routesList.setAttribute("aria-label", labels.routes);

    this.stepsList = el("ol", RC.steps);

    // RoutingPanel/Detail: the tinted bar holding the way back and the title,
    // and — when turnByTurn.download is on — the download button beside it.
    // The button sits outside the tinted bar rather than inside it: the design
    // keeps it a plain icon on the panel's own background, not tinted with
    // the "Route overview" pill.
    const detailTop = el("div", RC.detailTop);
    const back = button(RC.detailBack, labels.backToRoutes, "arrow-left");
    back.addEventListener("click", () => {
      this.showRoutes();
    });
    detailTop.append(back, el("h3", RC.detailTitle, labels.routeOverview));

    const detailHeader = el("div", RC.detailHeader);
    detailHeader.append(detailTop);

    if (context.options.turnByTurn.download) {
      const downloadToggle = button(RC.detailDownload, labels.download, "download");
      const download = new Dropdown(downloadToggle, labels.download);
      download.menu.append(
        menuButton(labels.downloadPdf, () => {
          download.close();
          this.downloadGuide();
        }),
        menuButton(labels.downloadGpx, () => {
          download.close();
          this.downloadGpx();
        }),
      );
      detailHeader.append(download.element);
    }

    this.detailElement = el("div", RC.view);
    this.detailElement.dataset.view = "detail";
    this.detailElement.hidden = true;
    this.detailElement.append(detailHeader, this.stepsList);

    // classed rather than bare: the turn-by-turn layout needs a flex chain from
    // the panel body down to the step list, and this is a link in it
    this.element = el("div", RC.results);
    this.element.append(this.statusElement, this.emptyElement, this.errorElement, this.skeleton, this.routesList, this.detailElement);
  }

  //#region State

  /**
   * Matches the number of placeholders to the number of cards they stand in
   * for: the routes on screen when there are any, the number the request is
   * expected to return when there are not.
   */
  private syncSkeleton(routeCount: number): void {
    const expected = routeCount > 0 ? routeCount : Math.min(this.context.options.alternates + 1, 3);
    if (this.skeleton.childElementCount === expected) return;

    this.skeleton.replaceChildren();
    for (let index = 0; index < expected; index++) {
      this.skeleton.append(el("div", RC.skeletonCard));
    }
  }

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
      // a consumer's status element speaks for every state, this one included
      this.emptyElement.hidden = true;
      return;
    }

    // The service answers an unroutable pair two ways: a response with no routes
    // in it, and an error saying it found none. Both are the same dead end to
    // the visitor, so both get the drawing rather than a red card — which is
    // kept for failures they can do nothing about (a key, a quota, an outage).
    const reason = this.status === "error" ? classifyRoutingError(this.error) : null;
    const foundNothing = this.status === "empty" || (reason !== null && NOT_FOUND_REASONS.has(reason));

    this.errorElement.hidden = !(this.status === "error" && !foundNothing);
    if (this.status === "error" && reason !== null) {
      // the service's own sentence is a developer's message: it names an
      // internal limit rather than the thing the visitor can do about it. It
      // stays on the title, and in the `routingerror` event, for debugging.
      this.errorElement.textContent = labels.errors[reason] ?? labels.error;
      this.errorElement.title = this.error?.message ?? "";
    }

    // "empty" is drawn rather than written: the block below says it, so the line
    // has nothing to add
    const text = this.status === "loading" ? (routes.length === 0 ? labels.loading : labels.recalculating) : this.status === "idle" ? labels.needsWaypoints : "";

    this.emptyTitle.textContent = labels.noRoutes;
    // A not-found reason is more specific than the generic hint — it names the
    // mode, or the stop that is off the road — so it wins when there is one.
    // Any other reason belongs to the red card, and must not leak in here.
    this.emptyHint.textContent = (foundNothing && reason !== null ? labels.errors[reason] : undefined) ?? labels.noRoutesHint;
    this.emptyHint.title = (foundNothing ? this.error?.message : "") ?? "";
    this.emptyElement.hidden = !foundNothing || this.isDetailOpen();

    // the skeleton stands in for the results for as long as a request is in
    // flight, first one or a later one: a recalculation replaces every card, so
    // leaving the old ones up — dimmed, or worse, not — offers numbers that are
    // about to change as though they were the answer. The line stays in the
    // accessible tree, clipped, as the live region that says which it is.
    const skeletonShowing = this.status === "loading" && !this.isDetailOpen();
    this.syncSkeleton(routes.length);
    this.skeleton.hidden = !skeletonShowing;
    setDataFlag(this.statusElement, "silent", skeletonShowing);

    this.statusElement.textContent = text;
    this.statusElement.hidden = text === "" || this.isDetailOpen();

    setBooleanAttribute(this.routesList, "aria-busy", this.status === "loading");
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
    // hidden rather than emptied while a request runs: the cards are kept so
    // that a failed recalculation can put the previous answer straight back.
    // A dead end takes the whole space, so nothing is listed under it — the
    // controller drops the results behind a not-found failure, and this keeps
    // any cards a consumer put there from reading as the answer to it.
    this.routesList.hidden = this.isDetailOpen() || this.status === "loading" || !this.emptyElement.hidden;
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
    const steps = this.context.routing.getSteps();
    const units = this.context.routing.getUnits();

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

      // the row is about to take focus from the click; taken quietly, it keeps
      // the ring for the keyboard and leaves a clicked row its background alone
      stepButton.addEventListener("mousedown", () => {
        focusQuietly(stepButton);
      });

      stepButton.dataset.key = entry.key;
      setDataFlag(stepButton, "active", entry.key === this.activeStep?.key);
      // marked on every step, whether or not clicking one moves the map: the
      // row the user picked is worth keeping visible either way
      stepButton.addEventListener("click", () => {
        this.setActiveStep(entry);
        // asserted rather than left to the hover that usually precedes it: a
        // tap, a keyboard activation and a re-rendered list under a still
        // pointer all reach here without a `mouseenter` of their own
        this.context.routing.highlightStep(entry);
      });

      // Pointing at a turn puts a dot where it happens, so the list and the map
      // are read together; the keyboard route through the list does the same.
      // Leaving a row falls back to the clicked one rather than to nothing —
      // passing over a neighbour must not throw away where the user was.
      stepButton.addEventListener("mouseenter", () => {
        this.context.routing.highlightStep(entry);
      });
      stepButton.addEventListener("focus", () => {
        this.context.routing.highlightStep(entry);
      });
      stepButton.addEventListener("mouseleave", () => {
        this.context.routing.highlightStep(this.activeStep);
      });
      stepButton.addEventListener("blur", () => {
        this.context.routing.highlightStep(this.activeStep);
      });

      const instruction = entry.step.maneuver?.instruction ?? entry.step.streetName ?? "Continue";
      const distance = formatters.distance(entry.step.length, units);

      const stepIcon = icon(maneuverIconId(entry.step.maneuver?.type), entry.step.maneuver?.type);
      stepIcon.classList.add(RC.stepIcon);

      // the design stacks the two: the instruction, then its distance under it
      const lines = el("span", RC.stepLines);
      lines.append(el("span", RC.stepText, instruction), el("span", RC.stepDistance, distance));
      stepButton.append(stepIcon, lines);
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

  /** Moves the clicked-step mark to one row, without rebuilding the list. */
  private setActiveStep(entry: FlatRouteStep): void {
    if (this.activeStep?.key === entry.key) return;
    this.activeStep = entry;

    for (const step of this.stepsList.querySelectorAll<HTMLElement>(`.${RC.step}`)) {
      setDataFlag(step, "active", step.dataset.key === entry.key);
    }
  }

  //#endregion

  //#region Views

  /** Opens the turn-by-turn view for the selected route. */
  showDetail(opener?: HTMLElement): void {
    this.detailOpener = opener ?? null;
    // a fresh guide, with no row picked out of it yet and no dot on the map
    this.activeStep = null;
    this.context.routing.highlightStep(null);
    this.detailElement.hidden = false;
    this.routesList.hidden = true;
    this.statusElement.hidden = true;
    this.emptyElement.hidden = true;
    this.skeleton.hidden = true;
    this.errorElement.hidden = true;
    this.renderSteps();
    // the keyboard must not be left on the hidden list, but a pointer click
    // that opened this view should not leave a ring behind either
    focusQuietly(this.detailElement.querySelector<HTMLButtonElement>(`.${RC.detailBack}`));
    this.context.control.fire("routinguiviewchange", { view: "detail" });
  }

  /** Returns to the route list, restoring focus to whatever opened the detail. */
  showRoutes(): void {
    // the dot marks a turn of the guide being read, and the guide is closing
    this.activeStep = null;
    this.context.routing.highlightStep(null);
    this.detailElement.hidden = true;
    this.routesList.hidden = false;
    this.render();
    focusQuietly(this.detailOpener);
    this.detailOpener = null;
    this.context.control.fire("routinguiviewchange", { view: "list" });
  }

  /** `true` while the turn-by-turn view is open. */
  isDetailOpen(): boolean {
    return !this.detailElement.hidden;
  }

  //#endregion

  //#region Download

  /** Prints the turn-by-turn guide for the selected route, saved as PDF through the browser's own dialog. */
  private downloadGuide(): void {
    const { labels, formatters, language } = this.context.options;
    const route = this.context.routing.getSelectedRoute();
    if (!route) return;

    printRouteGuide(route, this.context.routing.getSteps(), this.context.routing.getUnits(), labels, formatters, language);
    this.context.control.fire("routinguidownload", { format: "pdf" });
  }

  /** Saves the selected route as a GPX track. */
  private downloadGpx(): void {
    const route = this.context.routing.getSelectedRoute();
    if (!route) return;

    downloadText("route.gpx", routeToGpx(route), "application/gpx+xml");
    this.context.control.fire("routinguidownload", { format: "gpx" });
  }

  //#endregion
}
