import { describe, expect, it } from "vitest";
import { ResultsView } from "../../src/Routing/ui/routing-results-view";
import { RC, resolveControlOptions } from "../../src/Routing/ui/routing-ui-defaults";
import type { RoutingPanelContext } from "../../src/Routing/ui/routing-ui-context";
import { FetchError } from "../../src/utils/errors";

/** A rejection shaped like the one `routing.directions` throws. */
function fetchError(status: number, detail?: string): FetchError {
  const response = { url: "https://api.maptiler.com/routing/v1/directions", status, statusText: "" } as Response;
  return new FetchError(response, "directions", "routing.directions", detail);
}

/**
 * The little of the panel a status render actually reads.
 *
 * The view is built against the context rather than the control, which is what
 * lets a test hand it a session with no routes in it and nothing else.
 */
function context(): RoutingPanelContext {
  return {
    options: resolveControlOptions(),
    routing: {
      getRoutes: () => [],
      getSelectedIndex: () => -1,
      getUnits: () => "km",
    },
    control: { fire: () => undefined },
  } as unknown as RoutingPanelContext;
}

/** The state one status renders to, as the visitor would see it. */
function stateOf(view: ResultsView) {
  const root = view.element;
  const empty = root.querySelector<HTMLElement>(`.${RC.empty}`);
  const error = root.querySelector<HTMLElement>(`.${RC.error}`);

  return {
    notFoundShown: empty?.hidden === false,
    errorShown: error?.hidden === false,
    title: root.querySelector(`.${RC.emptyTitle}`)?.textContent,
    hint: root.querySelector(`.${RC.emptyHint}`)?.textContent,
    errorText: error?.textContent,
  };
}

describe("ResultsView, when there is no route to show", () => {
  it("draws the not-found state for a response with no routes in it", () => {
    const view = new ResultsView(context());
    view.setStatus("empty");
    view.render();

    const state = stateOf(view);
    expect(state.notFoundShown).toBe(true);
    expect(state.errorShown).toBe(false);
    expect(state.title).toBe("No routes found");
    // nothing more specific was said, so the state offers what to try
    expect(state.hint).toBe("Try changing your start point, destination, or transport mode.");
  });

  it.each([
    ["no path could be found", '{"error_code":442,"error":"No path could be found for input"}', "No route between these points for this transport mode."],
    ["a stop that is off the road", "Could not snap to the road network", "One of the stops is not on a road. Move it closer to one."],
    ["a route past the distance limit", "Maximum path distance exceeded", "This route is too long for this transport mode. Try another mode, or bring the stops closer together."],
  ])("draws it for %s too, with the reason as the hint", (_name, detail, expected) => {
    const view = new ResultsView(context());
    view.setStatus("error", fetchError(400, detail));
    view.render();

    const state = stateOf(view);
    // the same dead end as an empty response, so the same drawing rather than a
    // red card the visitor can do nothing with
    expect(state.notFoundShown).toBe(true);
    expect(state.errorShown).toBe(false);
    expect(state.title).toBe("No routes found");
    expect(state.hint).toBe(expected);
  });

  it.each([
    [401, "This API key cannot compute routes."],
    [429, "Too many route requests. Try again in a moment."],
    [500, "The routing service is unavailable. Try again shortly."],
  ])("leaves HTTP %i a red card, since no change of stops would help", (status, expected) => {
    const view = new ResultsView(context());
    view.setStatus("error", fetchError(status));
    view.render();

    const state = stateOf(view);
    expect(state.errorShown).toBe(true);
    expect(state.errorText).toBe(expected);
    expect(state.notFoundShown).toBe(false);
  });

  it("keeps the not-found state out of the way of every other status", () => {
    const view = new ResultsView(context());

    for (const status of ["idle", "loading", "ready"] as const) {
      view.setStatus(status);
      view.render();
      expect(stateOf(view).notFoundShown).toBe(false);
    }
  });

  it("takes the words from the labels, so it can be translated", () => {
    const options = resolveControlOptions({ labels: { noRoutes: "Aucun itinéraire", noRoutesHint: "Essayez un autre mode." } });
    const view = new ResultsView({ ...context(), options } as RoutingPanelContext);
    view.setStatus("empty");
    view.render();

    expect(stateOf(view).title).toBe("Aucun itinéraire");
    expect(stateOf(view).hint).toBe("Essayez un autre mode.");
  });
});
