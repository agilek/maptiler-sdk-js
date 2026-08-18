import { describe, expect, it, vi } from "vitest";
import { RoutingGeocoder, type RoutingPlace } from "../../src/Routing/ui/routing-geocoder";
import type { ResolvedSearchOptions } from "../../src/Routing/ui/routing-ui-defaults";
import type { RoutingReverseProvider, RoutingSearchProvider } from "../../src/Routing/ui/routing-ui-types";

/**
 * Search options with a provider, so nothing in these tests reaches the network:
 * a provider replaces MapTiler Geocoding entirely, which is the point of it.
 */
function options(overrides: Partial<ResolvedSearchOptions> = {}): ResolvedSearchOptions {
  return {
    enabled: true,
    minLength: 2,
    // no debounce: the timer is not what is under test here
    debounceMs: 0,
    limit: 5,
    proximity: true,
    ...overrides,
  };
}

/** Waits for the debounce timer and the provider's promise to settle. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

const describeFeature = (feature: { place_name?: string; text?: string }) => feature.place_name ?? feature.text ?? "";

describe("RoutingGeocoder with a search provider", () => {
  it("lists what the provider returned", async () => {
    const provider: RoutingSearchProvider = () => [
      { name: "Bahnhofquai", label: "Bahnhofquai 15, 8001 Zurich", lngLat: [8.54, 47.37] },
      { label: "Vítězná 1058/5, Karlovy Vary", lngLat: [12.87, 50.23] },
    ];

    const geocoder = new RoutingGeocoder(options({ provider }), undefined, describeFeature);
    const results: RoutingPlace[] = [];
    geocoder.search("zur", undefined, (places) => results.push(...places));
    await settle();

    expect(results).toEqual([
      { name: "Bahnhofquai", label: "Bahnhofquai 15, 8001 Zurich", lngLat: [8.54, 47.37] },
      // a result with no short name repeats the label, so the row always has a
      // first line to show
      { name: "Vítězná 1058/5, Karlovy Vary", label: "Vítězná 1058/5, Karlovy Vary", lngLat: [12.87, 50.23] },
    ]);
  });

  it("tells the provider what the panel knows", async () => {
    const provider = vi.fn<RoutingSearchProvider>(() => []);
    const geocoder = new RoutingGeocoder(options({ provider, limit: 3 }), "fr", describeFeature);

    geocoder.search("  bern  ", [7.44, 46.95], () => undefined);
    await settle();

    expect(provider).toHaveBeenCalledTimes(1);
    const [query, context] = provider.mock.calls[0];
    // trimmed, so a provider never has to do it
    expect(query).toBe("bern");
    expect(context.proximity).toEqual([7.44, 46.95]);
    expect(context.language).toBe("fr");
    expect(context.limit).toBe(3);
    expect(context.signal.aborted).toBe(false);
  });

  it("withholds the map position when proximity is off", async () => {
    const provider = vi.fn<RoutingSearchProvider>(() => []);
    const geocoder = new RoutingGeocoder(options({ provider, proximity: false }), undefined, describeFeature);

    geocoder.search("bern", [7.44, 46.95], () => undefined);
    await settle();

    expect(provider.mock.calls[0][1].proximity).toBeUndefined();
  });

  it("never asks for a query shorter than the minimum", async () => {
    const provider = vi.fn<RoutingSearchProvider>(() => []);
    const geocoder = new RoutingGeocoder(options({ provider, minLength: 4 }), undefined, describeFeature);

    const results: RoutingPlace[][] = [];
    geocoder.search("ber", undefined, (places) => results.push(places));
    await settle();

    expect(provider).not.toHaveBeenCalled();
    // and the field is told to clear, rather than left showing stale suggestions
    expect(results).toEqual([[]]);
  });

  it("keeps at most `limit` results, whatever the provider returns", async () => {
    const provider: RoutingSearchProvider = () => Array.from({ length: 9 }, (_, index) => ({ label: `Place ${index.toString()}`, lngLat: [0, index] as [number, number] }));
    const geocoder = new RoutingGeocoder(options({ provider, limit: 2 }), undefined, describeFeature);

    const results: RoutingPlace[] = [];
    geocoder.search("place", undefined, (places) => results.push(...places));
    await settle();

    expect(results.map((place) => place.label)).toEqual(["Place 0", "Place 1"]);
  });

  it("shows nothing when the provider throws, rather than breaking the panel", async () => {
    const provider: RoutingSearchProvider = () => {
      throw new Error("the address service is down");
    };
    const geocoder = new RoutingGeocoder(options({ provider }), undefined, describeFeature);

    const results: RoutingPlace[][] = [];
    geocoder.search("bern", undefined, (places) => results.push(places));
    await settle();

    expect(results).toEqual([[]]);
  });

  it("drops a superseded query, so the last keystroke is what the field answers", async () => {
    const provider: RoutingSearchProvider = (query) => [{ label: query, lngLat: [0, 0] }];
    const geocoder = new RoutingGeocoder(options({ provider, debounceMs: 5 }), undefined, describeFeature);

    const results: RoutingPlace[][] = [];
    geocoder.search("ber", undefined, (places) => results.push(places));
    geocoder.search("bern", undefined, (places) => results.push(places));
    await settle();
    await settle();

    expect(results).toEqual([[{ name: "bern", label: "bern", lngLat: [0, 0] }]]);
  });

  it("keeps one field's pending search when another field starts one", async () => {
    const provider: RoutingSearchProvider = (query) => [{ label: query, lngLat: [0, 0] }];
    const geocoder = new RoutingGeocoder(options({ provider, debounceMs: 5 }), undefined, describeFeature);

    const answered: string[] = [];
    // one geocoder serves every waypoint field: the second search must not
    // silently drop the first field's, which is keyed apart from it
    geocoder.search("ber", undefined, (places) => answered.push(`from:${places[0]?.label ?? ""}`), "from");
    geocoder.search("zur", undefined, (places) => answered.push(`to:${places[0]?.label ?? ""}`), "to");
    await settle();
    await settle();

    expect(answered.toSorted()).toEqual(["from:ber", "to:zur"]);
  });

  it("aborts the signal it handed out when the query is superseded", async () => {
    const signals: AbortSignal[] = [];
    const provider: RoutingSearchProvider = (_query, context) => {
      signals.push(context.signal);
      return [];
    };
    const geocoder = new RoutingGeocoder(options({ provider }), undefined, describeFeature);

    geocoder.search("bern", undefined, () => undefined);
    await settle();
    geocoder.search("berne", undefined, () => undefined);

    expect(signals[0].aborted).toBe(true);
  });
});

//#region reverse

describe("RoutingGeocoder with a reverse provider", () => {
  it("names a coordinate with what the provider said", async () => {
    const reverse = vi.fn<RoutingReverseProvider>(() => "Somewhere in particular");
    const geocoder = new RoutingGeocoder(options({ reverse }), "de", describeFeature);

    await expect(geocoder.reverse([8.54, 47.37])).resolves.toBe("Somewhere in particular");

    const [lngLat, context] = reverse.mock.calls[0];
    expect(lngLat).toEqual([8.54, 47.37]);
    expect(context.language).toBe("de");
  });

  it("treats no answer as no name, leaving the coordinate on show", async () => {
    const geocoder = new RoutingGeocoder(options({ reverse: () => null }), undefined, describeFeature);

    await expect(geocoder.reverse([8.54, 47.37])).resolves.toBeUndefined();
  });

  it("swallows a failing provider", async () => {
    const geocoder = new RoutingGeocoder(
      options({
        reverse: () => {
          throw new Error("no");
        },
      }),
      undefined,
      describeFeature,
    );

    await expect(geocoder.reverse([8.54, 47.37])).resolves.toBeUndefined();
  });
});

//#endregion
