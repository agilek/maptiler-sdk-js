# Routing component — developer guide

A step-by-step guide to adding turn-by-turn routing to a map with the MapTiler SDK. For the full
API reference see the [Routing and directions](../README.md#routing-and-directions) section of the
README — this guide only covers the path from zero to a working, customised panel.

> 🚀 [`index.html`](index.html) in this folder is the simplest possible working example — a single
> HTML file with the routing panel turned on. Routing hasn't shipped to the CDN yet, so it loads a
> local build instead: from the repo root, run `npm run build-umd && npm run build-css`, add your
> API key to `index.html`, then open the file in a browser. Once routing ships in a release, this
> goes back to the usual CDN `<script>`/`<link>` tags (see the comment in the file).

## 1. Prerequisites

- `@maptiler/sdk` with a valid API key configured (`config.apiKey = "..."`).
- A `Map` instance. Routing works with or without a panel, and with or without a map at all (see
  step 7).

> 📣 Each computed route counts against your MapTiler Cloud API key quota. The panel's place search
> additionally uses the Geocoding API, unless you supply your own provider (step 6).

## 2. Add the panel

The fastest path — one map option, no extra imports:

```ts
import { Map } from "@maptiler/sdk";

const map = new Map({ container: "map", routingControl: true });
```

This shows a small map-control button. Clicking it opens the panel beside it and turns the button
into a close button.

To configure it, add the control yourself instead of using the boolean option:

```ts
import { Map, MaptilerRoutingControl } from "@maptiler/sdk";

const map = new Map({ container: "map" });

map.addControl(
  new MaptilerRoutingControl({
    modes: ["car", "bicycle"],
    filters: ["departure", "avoidances"],
    alternates: 2,
  }),
  "top-left",
);
```

Pass `launcher: false` to skip the button and render the panel open and in place instead.

## 3. Or drive routing without a panel

If you're building your own UI, skip the control and use the headless session directly:

```ts
const routing = map.enableRouting({ profile: "car", alternates: 2 });

routing.setWaypoints([
  [8.5417, 47.3769],  // Zurich
  [12.8724, 50.2329], // Karlovy Vary
]);

routing.on("routingroutes", (event) => {
  const best = event.routes[event.selectedIndex];
  console.log(best.summary.totalLength, routing.getUnits());
});
```

`RoutingController` covers waypoints (`addWaypoint`, `updateWaypoint`, `moveWaypoint`,
`removeWaypoint`), config (`setProfile`, `setUnits`, `setDepartureTime`, `setAlternates`), results
(`getRoutes`, `selectRoute`, `getSteps`, `zoomToStep`, `fitBounds`) and lifecycle (`calculate`,
`cancel`, `clear`). `map.addControl(new MaptilerRoutingControl())` and `map.enableRouting()` share
one session per map — a route set programmatically shows up in the panel, and vice versa.

Events to listen for: `routingstart`, `routingroutes`, `routingselect`, `routingwaypoints`,
`routingconfig`, `routingerror`, `routingclear`.

## 4. Pick transport profiles and their options

Four profiles, each with its own accepted options — TypeScript rejects a mismatched combination at
compile time:

| Profile | Options |
|---|---|
| `car` | `mode` (`fastest` \| `shortest` \| `balanced`), `topSpeed`, `avoidances` |
| `truck` | `topSpeed`, `avoidances`, `weight`, `height`, `length`, `axleLoad`, `hazmat` |
| `bicycle` | `type` (`road` \| `gravel` \| `mountain` \| `city`), `cyclingSpeed` |
| `pedestrian` | `walkingSpeed` |

```ts
new MaptilerRoutingControl({
  modes: [{ id: "car", label: "Drive" }, { id: "bicycle" }],
  modeDisplay: "icon",   // "both" (default) | "icon" | "label" | "none"
});
```

## 5. Theme and style the panel

Two shipped palettes, switched with one option:

```ts
new MaptilerRoutingControl({ theme: "dark" }); // "light" | "dark" | "auto" (default)
```

Every colour, radius and size is a CSS custom property on the panel root, so house-style branding
doesn't need a fork:

```css
.maptiler-routing {
  --maptiler-routing-accent: #e2001a;
  --maptiler-routing-radius: 4px;
  --maptiler-routing-width: 420px;
}
```

`unstyled: true` drops the root class entirely if you want to style the DOM from scratch. See the
README for the full list of stable class names.

## 6. Localize labels and plug in your own place search

The panel follows `config.primaryLanguage` for turn-by-turn text, place names and formatted
values. Override individual labels — English is the only shipped language:

```ts
new MaptilerRoutingControl({
  language: "fr",
  labels: {
    title: "Itinéraire",
    from: "Départ",
    to: "Arrivée",
  },
});
```

By default, the waypoint fields search MapTiler Geocoding. To search your own data instead —
an internal address database, a different geocoder — supply a `provider`. The panel still owns
debouncing, cancellation and ordering, and passes you an `AbortSignal` for stale queries:

```ts
new MaptilerRoutingControl({
  search: {
    provider: async (query, { proximity, limit, signal }) => {
      const response = await fetch(`/api/places?q=${encodeURIComponent(query)}`, { signal });
      const places = await response.json();

      return places.slice(0, limit).map((place) => ({
        name: place.name,     // first line of the suggestion row
        label: place.address, // second line, and what the field shows once picked
        lngLat: [place.lng, place.lat],
      }));
    },

    // optional: name a point placed on the map (click, drag, marker) instead of typed
    reverse: async ([lng, lat], { signal }) => {
      const response = await fetch(`/api/nearest?lng=${lng}&lat=${lat}`, { signal });
      return (await response.json()).address;
    },
  },
});
```

Notes:
- `minLength`, `debounceMs` and `limit` still apply to a `provider`; `country` does not — filter
  results yourself.
- Throwing or rejecting shows no suggestions rather than an error, so a flaky search never breaks
  the panel.
- Waypoints picked through a `provider` are ordinary waypoints — dragging, reordering, and routing
  all work the same as with the built-in search.

## 7. Use the routing API without a map

For server-side calls or a page that computes a route before a map exists:

```ts
import { routing } from "@maptiler/sdk";

const response = await routing.directions({
  profile: "bicycle",
  locations: [
    { lon: 8.54, lat: 47.37 },
    { lon: 12.87, lat: 50.23 },
  ],
  profileOptions: { type: "gravel" },
  response: { units: "km", alternates: 2 },
});

const coordinates = routing.getRouteCoordinates(response.route);
```

Handle errors with `routing.classifyError`, which turns the service's developer-facing message
into one of `tooFar`, `noRoute`, `unreachable`, `unauthorized`, `rateLimited`, `unavailable` or
`unknown`:

```ts
try {
  await routing.directions(request);
} catch (error) {
  if (routing.classifyError(error) === "tooFar") suggestAnotherMode();
}
```

The panel does this automatically, showing a `labels.errors` string while keeping the original
message on the element's `title` for debugging.

## 8. Go further: replace part of the panel

If theming and labels aren't enough, `renderers` swaps out one subsection at a time — returning
`undefined` falls back to the built-in rendering:

```ts
new MaptilerRoutingControl({
  renderers: {
    routeCard: ({ route, index, selected, control, formatters }) => {
      const card = document.createElement("li");
      card.textContent = formatters.duration(route.summary.totalTime);
      card.className = selected ? "my-card my-card--selected" : "my-card";
      card.addEventListener("click", () => control.getRouting()?.selectRoute(index));
      return card;
    },
  },
});
```

Available hooks: `transportModes`, `waypointRow`, `routeCard`, `step`, `status`, `footer`. If
you're replacing all of them, skip the control and drive `map.enableRouting()` directly (step 3).

## Where to go next

- Simplest working example: [`index.html`](index.html) in this folder
- Full option and label reference: [README.md § Routing and directions](../README.md#routing-and-directions)
- Fuller live example with a settings panel: `../demos/src/17-routing-control.ts`
