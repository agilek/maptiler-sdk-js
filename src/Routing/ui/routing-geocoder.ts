import type { GeocodingFeature } from "@maptiler/client";
import { geocoding } from "../../geocoding";
import type { ResolvedSearchOptions } from "./routing-ui-defaults";

/** Where the map is looking, used to bias results towards what the user sees. */
export type GeocoderProximity = [number, number];

/**
 * Debounced access to MapTiler Geocoding for the waypoint fields.
 *
 * Holds no DOM: it owns the debounce timer and the abort controller, and hands
 * results back through callbacks. That keeps the request lifecycle testable and
 * out of the view code.
 */
export class RoutingGeocoder {
  private readonly options: ResolvedSearchOptions;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;

  constructor(options: ResolvedSearchOptions) {
    this.options = options;
  }

  /**
   * Searches for a place name, debounced.
   *
   * @param query - What the user typed.
   * @param proximity - Map center, used to bias results when enabled.
   * @param onResults - Called with the suggestions, or an empty list.
   *
   * @remarks
   * A query shorter than the configured minimum clears the suggestions without
   * a request. Failures resolve to an empty list rather than surfacing an
   * error: a geocoding hiccup must not break the routing panel.
   */
  search(query: string, proximity: GeocoderProximity | undefined, onResults: (features: GeocodingFeature[]) => void): void {
    this.cancel();

    const trimmed = query.trim();
    if (trimmed.length < this.options.minLength) {
      onResults([]);
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      const controller = new AbortController();
      this.controller = controller;

      geocoding
        .forward(trimmed, {
          autocomplete: true,
          limit: this.options.limit,
          ...(this.options.country ? { country: [...this.options.country] } : {}),
          ...(this.options.proximity && proximity ? { proximity } : {}),
        })
        .then((result) => {
          if (controller.signal.aborted) return;
          onResults(result.features);
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
    try {
      const result = await geocoding.reverse(lngLat, { limit: 1 });
      // `.at()` rather than `[0]`: an empty result set is normal out at sea
      const feature = result.features.at(0);
      return feature?.place_name ?? feature?.text;
    } catch {
      return undefined;
    }
  }

  /** Drops the pending debounce and aborts the request in flight. */
  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.controller?.abort();
    this.controller = null;
  }
}
