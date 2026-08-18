import type { GeocodingFeature } from "@maptiler/client";
import { geocoding } from "../../geocoding";
import type { ResolvedSearchOptions } from "./routing-ui-defaults";
import type { RoutingSearchResult } from "./routing-ui-types";

/** Where the map is looking, used to bias results towards what the user sees. */
export type GeocoderProximity = [number, number];

/**
 * One suggestion, as the field shows it.
 *
 * Both sources land here — MapTiler Geocoding and a consumer's own
 * {@link RoutingSearchProvider} — so the view knows nothing about where a place
 * came from, and the two behave identically once found.
 */
export type RoutingPlace = {
  /** First line of the row: the name on its own. */
  name: string;
  /** Second line, and the text the field takes when the row is picked. */
  label: string;
  /** Position, as `[lng, lat]`. */
  lngLat: [number, number];
};

/**
 * Debounced access to place search for the waypoint fields.
 *
 * MapTiler Geocoding by default; the `search.provider` option puts a consumer's
 * own search behind the same field instead. Either way this class owns the
 * debounce, the abort and the ordering, so the view sees one shape of result and
 * one lifecycle.
 *
 * Holds no DOM: results come back through callbacks, which keeps the request
 * lifecycle testable and out of the view code.
 */
export class RoutingGeocoder {
  private readonly options: ResolvedSearchOptions;
  /**
   * Language the place names come back in.
   *
   * The panel's own language (see `resolveControlOptions`), so a map configured
   * for German offers German place names in its search — the service otherwise
   * answers in whatever it considers local. A provider is told the same, and
   * decides for itself what to do with it.
   */
  private readonly language?: string;
  /**
   * How a MapTiler feature is written out, from `formatters.waypointLabel`.
   *
   * Only our own results go through it: a provider states its own text, and a
   * formatter written for a `GeocodingFeature` has nothing to say about it.
   */
  private readonly describe: (feature: GeocodingFeature) => string;

  /**
   * The pending debounce and request per field, keyed by the caller's token.
   *
   * One geocoder serves every waypoint field, so this state cannot be a single
   * pair: with one timer between them, typing in *To* within the debounce
   * window dropped whatever *From* had queued, and that field simply never got
   * its results. Same key still supersedes, which is what makes the next
   * keystroke in one field replace its own pending search.
   */
  private readonly pending = new Map<string, { timer: ReturnType<typeof setTimeout> | null; controller: AbortController | null }>();

  /** Reverse lookups in flight, so a teardown can abort the ones that can be. */
  private readonly reverseControllers = new Set<AbortController>();

  constructor(options: ResolvedSearchOptions, language: string | undefined, describe: (feature: GeocodingFeature) => string) {
    this.options = options;
    this.language = language;
    this.describe = describe;
  }

  /**
   * Searches for a place name, debounced.
   *
   * @param query - What the user typed.
   * @param proximity - Map center, used to bias results when enabled.
   * @param onResults - Called with the suggestions, or an empty list.
   * @param field - Which field is searching, so that fields do not cancel each
   * other's pending searches. Callers with one field can leave it out.
   *
   * @remarks
   * A query shorter than the configured minimum clears the suggestions without
   * a request. Failures resolve to an empty list rather than surfacing an
   * error: a hiccup in the search must not break the routing panel — and a
   * provider is a consumer's own code, which makes that more likely, not less.
   */
  search(query: string, proximity: GeocoderProximity | undefined, onResults: (places: RoutingPlace[]) => void, field = ""): void {
    this.cancel(field);

    const trimmed = query.trim();
    if (trimmed.length < this.options.minLength) {
      onResults([]);
      return;
    }

    const state: { timer: ReturnType<typeof setTimeout> | null; controller: AbortController | null } = { timer: null, controller: null };
    this.pending.set(field, state);

    state.timer = setTimeout(() => {
      state.timer = null;
      const controller = new AbortController();
      state.controller = controller;

      this.find(trimmed, proximity, controller.signal)
        .then((places) => {
          if (controller.signal.aborted) return;
          onResults(places.slice(0, this.options.limit));
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          onResults([]);
        });
    }, this.options.debounceMs);
  }

  /**
   * Names a coordinate, for a waypoint that was placed or dragged on the map.
   *
   * @returns The place name, or `undefined` when the lookup fails — the caller
   * keeps showing the coordinate rather than blanking the field.
   */
  async reverse(lngLat: [number, number]): Promise<string | undefined> {
    const controller = new AbortController();
    this.reverseControllers.add(controller);

    try {
      const custom = this.options.reverse;
      if (custom) return (await custom(lngLat, { language: this.language, signal: controller.signal })) ?? undefined;

      // no signal: `geocoding.reverse` takes none, so the built-in lookup runs
      // to completion and {@link cancel} can only stop a custom one
      const result = await geocoding.reverse(lngLat, { limit: 1, ...(this.language ? { language: this.language } : {}) });
      // `.at()` rather than `[0]`: an empty result set is normal out at sea
      const feature = result.features.at(0);
      return feature ? this.describe(feature) || feature.text : undefined;
    } catch {
      return undefined;
    } finally {
      this.reverseControllers.delete(controller);
    }
  }

  /**
   * Drops the pending debounce and aborts the request in flight.
   *
   * @param field - Which field to cancel. Omitted, every field is cancelled —
   * which is what tearing the panel down wants.
   */
  cancel(field?: string): void {
    if (field === undefined) {
      for (const key of [...this.pending.keys()]) this.cancel(key);
      for (const controller of this.reverseControllers) controller.abort();
      this.reverseControllers.clear();
      return;
    }

    const state = this.pending.get(field);
    if (!state) return;

    if (state.timer !== null) clearTimeout(state.timer);
    state.controller?.abort();
    this.pending.delete(field);
  }

  /** Runs the query against whichever search this panel was given. */
  private async find(query: string, proximity: GeocoderProximity | undefined, signal: AbortSignal): Promise<RoutingPlace[]> {
    const provider = this.options.provider;

    if (provider) {
      const results = await provider(query, {
        // the option is what decides whether biasing is offered at all, so an
        // absent proximity is the instruction "do not bias this"
        ...(this.options.proximity && proximity ? { proximity } : {}),
        language: this.language,
        limit: this.options.limit,
        signal,
      });

      return results.map((result) => toPlace(result));
    }

    const result = await geocoding.forward(query, {
      autocomplete: true,
      limit: this.options.limit,
      ...(this.language ? { language: this.language } : {}),
      ...(this.options.country ? { country: [...this.options.country] } : {}),
      ...(this.options.proximity && proximity ? { proximity } : {}),
    });

    return result.features.map((feature) => ({
      name: feature.text,
      label: this.describe(feature),
      lngLat: [feature.center[0], feature.center[1]],
    }));
  }
}

/**
 * Normalizes one provider result.
 *
 * `name` is optional in the public shape — a provider with nothing shorter than
 * the full label to show should not have to repeat it — and the row is built
 * from both lines, so it is filled in here rather than checked for everywhere.
 */
function toPlace(result: RoutingSearchResult): RoutingPlace {
  return {
    name: result.name ?? result.label,
    label: result.label,
    lngLat: [result.lngLat[0], result.lngLat[1]],
  };
}
