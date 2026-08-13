import { describe, expect, it } from "vitest";
import { DEFAULT_MANEUVER_ICON, maneuverIconId, resolveControlOptions } from "../../src/Routing/ui/routing-ui-defaults";

//#region maneuverIconId

describe("maneuverIconId", () => {
  it.each([
    ["leftTurn", "maneuver-left"],
    ["rightTurn", "maneuver-right"],
    ["slightLeftTurn", "maneuver-slight-left"],
    ["leftUTurn", "maneuver-uturn-left"],
    // the endpoints borrow the panel's own pin icons rather than a maneuver drawing
    ["start", "route-start"],
    ["destination", "route-pin"],
  ])("maps %s to %s", (type, expected) => {
    expect(maneuverIconId(type)).toBe(expected);
  });

  it("maps both roundabout kinds to the one roundabout icon", () => {
    expect(maneuverIconId("roundaboutEnter")).toBe("maneuver-roundabout");
    expect(maneuverIconId("roundaboutExit")).toBe("maneuver-roundabout");
  });

  it("falls back for a maneuver kind the SDK does not know", () => {
    // the service can add kinds without an SDK release
    expect(maneuverIconId("rampRight")).toBe(DEFAULT_MANEUVER_ICON);
  });

  it("falls back when no kind was reported", () => {
    expect(maneuverIconId(undefined)).toBe(DEFAULT_MANEUVER_ICON);
  });
});

//#endregion

//#region resolveControlOptions

describe("resolveControlOptions", () => {
  it("produces a working configuration from no options at all", () => {
    const options = resolveControlOptions();

    expect(options.modes.map((mode) => mode.id)).toEqual(["car", "truck", "bicycle", "pedestrian"]);
    expect(options.filters).toEqual(["mode", "departure", "vehicle", "bicycleType", "speed", "avoidances", "units"]);
    expect(options.clickToAddWaypoint).toBe("armed");
    expect(options.launcher).toBe(true);
    expect(options.open).toBe(false);
    expect(options.turnByTurn.enabled).toBe(true);
    expect(options.search.enabled).toBe(true);
    expect(options.modeDisplay).toBe("both");
    expect(options.showSingleMode).toBe(true);
  });

  it.each(["km", "mi"] as const)("keeps %s fixed, with no toggle for the end user", (units) => {
    const options = resolveControlOptions({ units });

    expect(options.units).toBe(units);
    expect(options.unitsSwitchable).toBe(false);
  });

  it("hands the unit to the end user only for 'shown'", () => {
    expect(resolveControlOptions({ units: "shown" }).unitsSwitchable).toBe(true);
    expect(resolveControlOptions({ units: "auto" }).unitsSwitchable).toBe(false);
    expect(resolveControlOptions().unitsSwitchable).toBe(false);
  });

  it("resolves 'auto' and the default to a concrete unit", () => {
    // whichever the environment reports, the session cannot start on "auto"
    expect(["km", "mi"]).toContain(resolveControlOptions({ units: "auto" }).units);
    expect(["km", "mi"]).toContain(resolveControlOptions().units);
  });

  it.each(["icon", "label", "both", "none"] as const)("accepts %s as the transport tab content", (modeDisplay) => {
    expect(resolveControlOptions({ modeDisplay }).modeDisplay).toBe(modeDisplay);
  });

  it("opens by default when there is no launcher to open it with", () => {
    expect(resolveControlOptions({ launcher: false }).open).toBe(true);
    expect(resolveControlOptions({ launcher: false, open: false }).open).toBe(false);
  });

  it("can drop the switcher when a single mode is left", () => {
    expect(resolveControlOptions({ showSingleMode: false }).showSingleMode).toBe(false);
  });

  it("normalizes a profile name into a mode configuration", () => {
    expect(resolveControlOptions({ modes: ["car", { id: "bicycle", label: "Ride" }] }).modes).toEqual([{ id: "car" }, { id: "bicycle", label: "Ride" }]);
  });

  it("keeps an empty mode list, which pins the profile and hides the switcher", () => {
    expect(resolveControlOptions({ modes: [] }).modes).toEqual([]);
  });

  it("merges labels one level deep, so overriding one keeps the rest", () => {
    const { labels } = resolveControlOptions({ labels: { title: "Itinéraire", modes: { car: "Voiture" } } });

    expect(labels.title).toBe("Itinéraire");
    expect(labels.modes.car).toBe("Voiture");
    expect(labels.modes.bicycle).toBe("Bike");
    expect(labels.addStop).toBe("Add a stop");
  });

  it("merges formatters, keeping the built-ins that were not overridden", () => {
    const { formatters } = resolveControlOptions({ formatters: { duration: () => "custom" } });

    expect(formatters.duration(3600)).toBe("custom");
    expect(formatters.distance(0.4, "km")).toBe("400 m");
  });

  it("expands the boolean form of search and turnByTurn", () => {
    expect(resolveControlOptions({ search: false }).search.enabled).toBe(false);
    expect(resolveControlOptions({ turnByTurn: false }).turnByTurn.enabled).toBe(false);

    const configured = resolveControlOptions({ search: { minLength: 4 }, turnByTurn: { maxZoom: 12 } });
    expect(configured.search.enabled).toBe(true);
    expect(configured.search.minLength).toBe(4);
    // untouched keys keep their defaults
    expect(configured.search.debounceMs).toBe(300);
    expect(configured.turnByTurn.maxZoom).toBe(12);
    expect(configured.turnByTurn.zoomOnStepClick).toBe(true);
  });
});

//#endregion
