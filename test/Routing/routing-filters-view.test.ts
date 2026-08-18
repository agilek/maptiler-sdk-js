import { describe, expect, it } from "vitest";
import { FiltersView } from "../../src/Routing/ui/routing-filters-view";
import { resolveControlOptions } from "../../src/Routing/ui/routing-ui-defaults";
import type { RoutingPanelContext } from "../../src/Routing/ui/routing-ui-context";
import type { RoutingProfile, RoutingProfileOptions } from "../../src/Routing/types";

/**
 * A session the filter row can be driven against.
 *
 * It holds one option object, as the real one does — which is the whole point
 * of these tests: the row remembers a set per profile, and the two have to be
 * kept in step across a transport switch.
 */
function session(profile: RoutingProfile = "car", profileOptions: RoutingProfileOptions = {}) {
  const pushes: RoutingProfileOptions[] = [];

  const routing = {
    profile,
    profileOptions,
    pushes,
    getProfile: () => routing.profile,
    getProfileOptions: () => ({ ...routing.profileOptions }),
    setProfileOptions: (options: RoutingProfileOptions) => {
      routing.profileOptions = options;
      pushes.push(options);
    },
    getUnits: () => "km" as const,
    setUnits: () => undefined,
    setProfile: (next: RoutingProfile) => {
      routing.profile = next;
    },
    setDepartureTime: () => undefined,
  };

  return routing;
}

type Session = ReturnType<typeof session>;

function view(routing: Session, options = {}): FiltersView {
  const context = {
    options: resolveControlOptions(options),
    routing,
    control: { fire: () => undefined },
  } as unknown as RoutingPanelContext;

  return new FiltersView(context);
}

/** Types a value into one of a filter menu's number fields, as the visitor would. */
function enterNumber(filters: HTMLElement, filter: string, index: number, value: string): void {
  const inputs = filters.querySelectorAll<HTMLInputElement>(`[data-filter="${filter}"] input[type="number"]`);
  const input = inputs[index];
  input.value = value;
  input.dispatchEvent(new Event("change"));
}

/**
 * Moves the session to another profile, as the panel does: the control listens
 * for the config event and calls `syncProfileOptions` (see
 * `MaptilerRoutingControl.wireRoutingEvents`), then re-renders the row.
 */
function switchProfile(routing: Session, filters: FiltersView, profile: RoutingProfile): void {
  routing.setProfile(profile);
  filters.syncProfileOptions();
  filters.render();
}

describe("FiltersView, across a transport switch", () => {
  it("re-sends the truck's dimensions when the session comes back to the truck", () => {
    const routing = session("truck");
    const filters = view(routing);
    filters.render();

    // VEHICLE_FIELDS order: height, length, weight, axle load, top speed
    enterNumber(filters.filtersElement, "vehicle", 0, "4.2");
    enterNumber(filters.filtersElement, "vehicle", 2, "18");

    expect(routing.getProfileOptions()).toMatchObject({ height: 4.2, weight: 18 });

    switchProfile(routing, filters, "car");
    // the car's own options are what the session routes with now
    expect(routing.getProfileOptions()).not.toMatchObject({ height: 4.2 });

    switchProfile(routing, filters, "truck");

    // the pills still show the dimensions, so the request has to carry them:
    // without the sync the session would still hold the car's object and the
    // truck would be routed as though it had no dimensions at all
    expect(routing.getProfileOptions()).toMatchObject({ height: 4.2, weight: 18 });

    const values = [...filters.filtersElement.querySelectorAll<HTMLInputElement>('[data-filter="vehicle"] input[type="number"]')].map((input) => input.value);
    expect(values).toEqual(["4.2", "", "18", "", ""]);
  });

  it("re-sends the cycling options when the session comes back to the bicycle", () => {
    const routing = session("bicycle");
    const filters = view(routing);
    filters.render();

    enterNumber(filters.filtersElement, "speed", 0, "22");
    expect(routing.getProfileOptions()).toMatchObject({ cyclingSpeed: 22 });

    switchProfile(routing, filters, "pedestrian");
    // walking has a speed of its own, which is what puts the pedestrian's
    // object on the session in place of the bicycle's
    enterNumber(filters.filtersElement, "speed", 0, "5");
    expect(routing.getProfileOptions()).toMatchObject({ walkingSpeed: 5 });

    switchProfile(routing, filters, "bicycle");

    expect(routing.getProfileOptions()).toMatchObject({ cyclingSpeed: 22 });
  });

  it("keeps the cycling pace out of the walking request", () => {
    const routing = session("bicycle");
    const filters = view(routing);
    filters.render();

    enterNumber(filters.filtersElement, "speed", 0, "22");
    switchProfile(routing, filters, "pedestrian");

    // 22 km/h is a pace for a bicycle and nonsense for a walk, so the walking
    // request carries no speed until the visitor states one
    expect(routing.getProfileOptions()).not.toMatchObject({ walkingSpeed: 22 });
    expect(filters.filtersElement.querySelector<HTMLInputElement>('[data-filter="speed"] input[type="number"]')?.value).toBe("");
  });

  it("sends the route preference the row draws from its first render", () => {
    const routing = session("car");
    const filters = view(routing);
    filters.render();

    // the pill reads "Fastest" before anything is touched, and a pill that
    // states a value the request omits is a pill that lies about the route
    expect(routing.getProfileOptions()).toMatchObject({ mode: "fastest" });
  });

  it("does not spend a request re-sending what the session already holds", () => {
    const routing = session("car");
    const filters = view(routing);
    filters.render();

    const pushed = routing.pushes.length;
    filters.syncProfileOptions();
    filters.render();

    expect(routing.pushes.length).toBe(pushed);
  });
});

describe("FiltersView, attached to a session that already carries options", () => {
  it("draws what the session holds rather than blanks", () => {
    const routing = session("truck", { weight: 12, height: 3.5, avoidances: { tolls: true } });
    const filters = view(routing);
    filters.render();

    const values = [...filters.filtersElement.querySelectorAll<HTMLInputElement>('[data-filter="vehicle"] input[type="number"]')].map((input) => input.value);
    expect(values).toEqual(["3.5", "", "12", "", ""]);

    const tolls = filters.filtersElement.querySelector<HTMLInputElement>('[data-filter="avoidances"] input[type="checkbox"]');
    expect(tolls?.checked).toBe(true);
  });

  it("leaves them on the session, rather than pushing its own blanks over them", () => {
    const routing = session("truck", { weight: 12, avoidances: { tolls: true } });
    const filters = view(routing);
    filters.render();

    expect(routing.getProfileOptions()).toMatchObject({ weight: 12, avoidances: { tolls: true } });

    // and an edit adds to them rather than replacing them
    enterNumber(filters.filtersElement, "vehicle", 0, "4");
    expect(routing.getProfileOptions()).toMatchObject({ weight: 12, height: 4, avoidances: { tolls: true } });
  });
});
