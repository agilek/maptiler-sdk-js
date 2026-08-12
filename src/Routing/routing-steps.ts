import { getLegCoordinates } from "./routing-geometry";
import type { Route, RouteStep } from "./types";

/**
 * A step tagged with the leg it belongs to, so it can be located on the map
 * and rendered in a flat list.
 */
export type FlatRouteStep = {
  /** The step itself. */
  step: RouteStep;
  /** Index of the leg within the route. */
  legIndex: number;
  /** Index of the step within its leg. */
  stepIndex: number;
  /** Stable `"<legIndex>-<stepIndex>"` key, for list rendering. */
  key: string;
};

/**
 * Every step of every leg, in travel order.
 *
 * @param route - The route to flatten.
 * @returns The flattened steps. Empty when the response carried no steps,
 * which is the case for `detailLevel: "legs"`.
 */
export function flattenRouteSteps(route: Route): FlatRouteStep[] {
  const flattened: FlatRouteStep[] = [];

  route.legs.forEach((leg, legIndex) => {
    leg.steps?.forEach((step, stepIndex) => {
      flattened.push({ step, legIndex, stepIndex, key: `${legIndex.toString()}-${stepIndex.toString()}` });
    });
  });

  return flattened;
}

/**
 * The slice of leg geometry a step covers.
 *
 * @param route - The route the step belongs to.
 * @param step - The flattened step to locate.
 * @returns `[lon, lat]` pairs from the step's first to its last coordinate,
 * inclusive. Empty when the leg does not exist.
 *
 * @remarks
 * Both indices are clamped to the leg's coordinate count: the service reports
 * them against its own geometry, and a mismatch would otherwise produce an
 * empty slice and a camera jump to nowhere.
 */
export function getStepCoordinates(route: Route, step: FlatRouteStep): [number, number][] {
  const leg = route.legs.at(step.legIndex);
  if (!leg) return [];

  const coordinates = getLegCoordinates(leg);
  if (coordinates.length === 0) return [];

  const last = coordinates.length - 1;
  const from = Math.min(Math.max(step.step.beginIndex ?? 0, 0), last);
  const to = Math.min(Math.max(step.step.endIndex ?? last, from), last);

  return coordinates.slice(from, to + 1);
}
