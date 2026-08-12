import type { Map as SDKMap } from "../../Map";
import type { RoutingController } from "../RoutingController";
import type { RoutingGeocoder } from "./routing-geocoder";
import type { ResolvedControlOptions } from "./routing-ui-defaults";
import type { MaptilerRoutingControl } from "./MaptilerRoutingControl";

/**
 * What every view of the panel needs: the session it renders, the map it sits
 * on, the resolved options, and the control itself for the render hooks.
 *
 * Passed down rather than reached for, so a view never has to know how the
 * control is wired together.
 */
export type RoutingPanelContext = {
  /** The control that owns the panel. */
  control: MaptilerRoutingControl;
  /** The map the panel is attached to. */
  map: SDKMap;
  /** The routing session the panel renders. */
  routing: RoutingController;
  /** Resolved control options, including labels and formatters. */
  options: ResolvedControlOptions;
  /** Geocoder shared by every waypoint field. */
  geocoder: RoutingGeocoder;
  /** Asks the control to re-render a region on the next frame. */
  invalidate: (region: string) => void;
};
