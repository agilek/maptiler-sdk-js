# MapTiler SDK JS — Engineering Styleguide

> **What this document is.** A description of how this SDK is built: its architecture, its
> conventions, and the mechanics of shipping a change. It is written to be read once by a new
> engineer and consulted repeatedly by both engineers and coding agents (Claude Code and
> similar) when implementing a feature.
>
> **How to use it.** When you are told *"extend feature XYZ"*, read §3 (Architecture), find the
> module archetype your feature belongs to in §5, then follow the delivery checklist in §17.
> Everything in between explains the rules those two sections assume.
>
> This is a description of the codebase as it is, not a wish list. Where a convention is applied
> unevenly, that is stated.

---

## 1. What this SDK is

`@maptiler/sdk` is a **thin, opinionated superset of [MapLibre GL JS](https://maplibre.org/)**,
tailored for MapTiler Cloud. It is a browser library published to npm (ESM), to a CDN (UMD), plus
a stylesheet.

Three ideas define the whole codebase:

1. **We extend MapLibre, we do not fork it.** `maplibre-gl` is a runtime dependency, externalised
   from the ESM bundle. Every SDK class either subclasses a MapLibre class or implements a
   MapLibre interface. When MapLibre's behaviour is close but not right, we *override the method
   and call `super`*.
2. **MapTiler Cloud is a first-class citizen.** API keys, sessions, style shorthands
   (`"streets-v2"`, `"maptiler://…"`), language handling, tile caching, telemetry and geocoding
   are built in rather than left to the user.
3. **The default path must work.** A missing API key, an unreachable style, an unsupported
   browser, a lost WebGL context — all of these produce a console warning and a working fallback,
   never a thrown error out of a constructor.

The SDK also re-exports `@maptiler/client` (the non-map MapTiler Cloud API layer: geocoding,
elevation, coordinates, static maps, styles) so consumers need one dependency.

---

## 2. Repository map

| Path | Contents |
|---|---|
| `src/index.ts` | The **single public entry point**. Nothing is public unless exported here. |
| `src/Map.ts` | The `Map` class — subclass of `maplibregl.Map`. The centre of gravity of the SDK. |
| `src/config.ts` | `SdkConfig` singleton (`config`): API key, language, session, caching, telemetry. |
| `src/constants/defaults.ts` | Frozen object of built-in default URLs/IDs. |
| `src/MLAdapters/` | One-file-per-class re-typings of MapLibre classes so they accept the SDK `Map`. |
| `src/controls/` | MapTiler versions of map controls (`Maptiler*Control`, `Minimap`). |
| `src/Marker/`, `src/MaptilerAnimation/`, `src/ImageViewer/`, `src/tile-preloading/` | **Feature modules** — the archetype to copy for new features. |
| `src/custom-layers/` | WebGL `CustomLayerInterface` implementations (`CubemapLayer`, `RadialGradientLayer`, `AnimatedRouteLayer`) with co-located GLSL. |
| `src/helpers/` | The `helpers.*` namespace: high-level "add a polyline/polygon/point/heatmap" APIs. |
| `src/converters/` | Format converters (GPX/KML → GeoJSON). |
| `src/utils/` | Small, dependency-free, framework-agnostic functions. |
| `src/style/` | `style_template.css` + `svg/` icons, compiled into `dist/maptiler-sdk.css`. |
| `src/ml-types.ts`, `src/types.ts`, `src/declarations.d.ts` | Shared and ambient types. |
| `test/` | Vitest unit tests + fixtures + the public-export snapshot. |
| `e2e/` | Playwright fixtures, tests and reference screenshots. |
| `demos/` | Numbered runnable demos, one per user-visible feature. |
| `scripts/`, `vite.config-*.ts`, `.github/workflows/` | Build, bundling and CI. |

---

## 3. Architecture

### 3.1 The layering

```
             ┌──────────────────────────────────────────┐
 public      │  src/index.ts  (the only export surface)  │
             └──────────────────────────────────────────┘
                              │
   ┌──────────────┬───────────┴──────────┬───────────────────┐
   │  Map.ts      │  feature modules      │  helpers/         │
   │  (facade)    │  (Marker, Animation,  │  converters/      │
   │              │   ImageViewer, …)     │  ColorRamp        │
   └──────┬───────┴───────────┬───────────┴───────────────────┘
          │                   │
   ┌──────┴───────┐   ┌───────┴────────┐   ┌────────────────┐
   │ controls/    │   │ custom-layers/ │   │ utils/, config │
   └──────┬───────┘   └───────┬────────┘   └────────────────┘
          │                   │
   ┌──────┴───────────────────┴──────────────────────────────┐
   │ MLAdapters/  — type-compatibility shims over MapLibre    │
   └──────────────────────────┬──────────────────────────────┘
                              │
                        maplibre-gl
```

**Dependency direction is downward only.** `utils/` never imports a feature module. Feature
modules import `utils/`, `config`, MapLibre types, and (as a *type-only* import) the SDK `Map`.

### 3.2 `Map` is a facade, not a god object

`Map.ts` is the largest file in the repo (~2500 lines) and it is deliberately a **facade**: it
owns option parsing, lifecycle wiring, and delegation. The actual logic lives in the feature
modules. Look at how markers are wired:

```ts
// src/Map.ts
addMarker(markerOrMarkerConfig: Marker | MapTilerMarkerOptions): this {
  const marker = markerOrMarkerConfig instanceof Marker ? markerOrMarkerConfig : new Marker(...);
  MarkerManager.register(marker, this);
  return this;
}
```

`Map` holds no marker state. The same pattern applies to `TilePreloader`, `Telemetry`,
`CubemapLayer`/`RadialGradientLayer` (space & halo) and `Minimap`.

**Rule:** when you add a feature to `Map`, `Map` gets *option parsing, a few delegating public
methods, and lifecycle hooks* — nothing else. State and algorithms go in your module.

### 3.3 The `MLAdapters/` layer

MapLibre classes are typed against `maplibregl.Map`. Our `Map` is a subclass, but several
MapLibre signatures are invariant in that parameter, so a plain subclass would not typecheck for
consumers. Each adapter is a ~13-line file that re-types one entry point:

```ts
// src/MLAdapters/GeoJSONSource.ts
export class GeoJSONSource extends maplibregl.GeoJSONSource {
  onAdd(map: SDKMap | MapMLGL) {
    super.onAdd(map as MapMLGL);
  }
}
```

**Rules for this directory:** one class per file, file named after the class, a one-line header
comment stating the purpose, *no behaviour changes*. If you need behaviour, subclass the adapter
in `controls/` or in a feature module — that is exactly what `MaptilerNavigationControl extends
NavigationControl` (the adapter) does.

### 3.4 Controls

`src/controls/` holds the MapTiler flavours of MapLibre controls. They subclass the **adapter**,
not `maplibregl` directly, and they customise behaviour by reaching into MapLibre internals when
necessary — this is accepted here, and each such override carries a comment saying what it
overloads and why (see `MaptilerNavigationControl._createButton` / `_rotateCompassArrow`).

`MaptilerExternalControl` / `MaptilerCustomControl` support the declarative
`data-maptiler-control` DOM-driven control API; `Minimap` is a control that owns a nested `Map`.

### 3.5 Custom WebGL layers

`src/custom-layers/<LayerName>/` is a self-contained folder:

```
CubemapLayer/
  CubemapLayer.ts      class implements CustomLayerInterface
  types.ts             options, presets, definitions
  constants.ts         geometry/lookup constants
  cubemap.vert.glsl    imported with `?raw`
  cubemap.frag.glsl
  loadCubemapTexture.ts  resource loading (memoized)
  index.ts             barrel
```

Conventions:
- Implement `CustomLayerInterface` (`id`, `type: "custom"`, `renderingMode`), never subclass a
  MapLibre layer.
- GLSL lives in `.glsl` files imported as `?raw` (typed in `src/declarations.d.ts`); shader
  variants are switched by string-replacing macro markers, not by branching in JS.
- Attribute/uniform names are declared as `as const` arrays and fed to the generic
  `Object3D<Attributes, Uniforms>` helper in `utils/webgl-utils.ts` so uniform lookups are typed.
- The layer is *driven by `Map`*: `map.setSpace()` / `map.setHalo()` create, configure and insert
  it. The class docblock says "you shouldn't have to use this class directly".
- Expensive resources (textures) are memoized and explicitly deleted.

### 3.6 Configuration

`config` is a **module-level singleton** extending `EventEmitter`. Settable properties that other
subsystems must react to are implemented as getter/setter pairs that `emit` on write:

```ts
set apiKey(k: string) { this._apiKey = k; clientConfig.apiKey = k; this.emit("apiKey", k); }
```

Consumers subscribe (`config.on("unit", …)`). Constructor options that duplicate a config value
(`apiKey`, `language`) **overwrite the global config** and this is documented in the option's
TSDoc.

Experimental config keys are prefixed `experimental_` on the public getter/setter.

Static values (URLs, source IDs) go in `src/constants/defaults.ts`, which is `Object.freeze`d.

---

## 4. The public API surface

### 4.1 `src/index.ts` is the contract

Everything the consumer can touch is exported from `src/index.ts`, in this order:

1. `import "./polyfills"` first.
2. `export type * from "maplibre-gl"` — MapLibre types pass through wholesale.
3. MapLibre *values* we pass through unchanged (`LngLat`, `addProtocol`, …).
4. MapLibre classes we have replaced, re-exported under a `*MLGL` suffix (`MapMLGL`,
   `MarkerMLGL`, …) so consumers can still reach the un-overloaded original.
5. SDK replacements of those classes (`Marker`, `Popup`, `NavigationControl`, …).
6. SDK-specific API (`Map`, `config`, controls, helpers, custom layers, converters, …).
7. Re-exports from `@maptiler/client`, enumerated **explicitly** (never `export *`).

`getVersion()` returns the build-time `__MT_SDK_VERSION__` define rather than importing
`package.json`, to keep the bundle clean.

### 4.2 Export rules

- **Type-only exports use `export type` / `export type *`.** The project is `isolatedModules`;
  mixing value and type exports breaks transpile-only consumers.
- Each feature module has an `index.ts` barrel that exports *only what is public*. Internal
  helpers (`marker-dom-utils`, `collision-helpers`, `MarkerManager`) are **not** exported.
- The `@maptiler/client` re-export list is explicit so upstream additions never leak silently.

### 4.3 Changing the public API is a test-visible act

`test/exports.test.ts` asserts the exact set of runtime exports against a hardcoded list *and* a
snapshot (`test/__snapshots__/exports.test.ts.snap`). Adding or removing an export **requires**
updating both. This is intentional friction: the public surface does not grow by accident.

### 4.4 Marking internals inside public classes

Members that must be reachable across modules but are not public API are keyed by **module-level
`Symbol`s**, declared in a `*-symbols.ts` file with namespaced descriptions:

```ts
export const FlushDOMUpdatesSymbol = Symbol("MapTiler:Marker:flushDOMUpdates");
```

`MarkerManager` calls `marker[FlushDOMUpdatesSymbol]()`; consumers cannot. Use `private` for
truly class-local state, symbols for cross-module internals, and `public` only for API.

---

## 5. Feature module anatomy

This is the archetype to copy. `src/Marker/` is the most complete example; `MaptilerAnimation/`,
`tile-preloading/` and `ImageViewer/` follow the same shape at smaller scale.

```
src/<Feature>/
  index.ts               barrel — public surface of the feature only
  <Feature>.ts           the main class (usually extends a MapLibre class)
  <Feature>Manager.ts    optional singleton coordinating instances across maps
  types.ts               ALL public types for the feature
  <feature>-symbols.ts   cross-module internal keys
  <feature>-<topic>.ts   focused internals: -dom-utils, -helpers, -config, -registry
```

Naming: **PascalCase for files exporting a class**, **kebab-case for files exporting functions,
types or constants**. Directories are PascalCase for feature modules (`Marker/`, `ImageViewer/`)
and lowercase for infrastructure groupings (`utils/`, `controls/`, `custom-layers/`).

### 5.1 The manager pattern

When a feature has many instances that must be coordinated per map, add a singleton manager
(`MarkerManager`, exported as an instance of a private `…Impl` class):

- Per-map and per-instance state lives in **`WeakMap`s** keyed by the `Map`/instance, so removing
  a map releases the state with no explicit teardown. This is stated in a comment where the
  WeakMap is declared.
- Work is **coalesced into one `requestAnimationFrame`**: dirty instances go into a `Set`, one
  frame is scheduled, the frame flushes everything. Bulk operations therefore cost one pass.
- The manager subscribes to map events (`styledata`, `click`, `move`) once, lazily, when the map
  is first seen.

### 5.2 Batched DOM writes

Property setters never touch the DOM. They record the value and enqueue:

```ts
private setProp<K extends keyof Props>(prop: K, value: Props[K]): void {
  this.props[prop] = value;
  this[PendingUpdatesSymbol][prop] = value;
  MarkerManager.addMarkerUpdateToQueue(this);
}
```

The manager flushes on the next frame. Consequences that are part of the convention:
- There is a **single source of truth** (`props`) plus a pending-diff object; the constructor
  options object is kept read-only as a construction-time snapshot (`readonly options`).
- Transient visual states (collision minimise/hide, UI states) write **straight to the DOM and
  mask their keys out of the flush**, so a queued user update cannot clobber them and the user's
  values survive the round trip.
- Geometry/measurement is computed from stored props and lookup tables — **no DOM reads in hot
  paths**. Any unavoidable measurement happens once, at registration time, and is cached.

---

## 6. TypeScript conventions

The compiler is configured `strict`, `noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch`, `isolatedModules`, target `es2021`.

**Types live in `types.ts`** next to the feature, grouped with `//#region` blocks and documented
with TSDoc on every exported member.

Patterns used throughout:

| Pattern | Example | Why |
|---|---|---|
| Const object + derived union instead of `enum` | `CollisionBehaviour = {…} as const; type CollisionBehaviour = (typeof …)[keyof typeof …]` | enum-free, tree-shakeable, works as both a value and a type |
| Derive from MapLibre types rather than redeclare | `Omit<MapOptionsML, "style" \| "attributionControl"> & { … }` | stays correct when MapLibre changes |
| Discriminated unions with `?: never` | `MarkerContentTypeIcon` vs `…TypeImageUrl` vs `…TypeTemplate` | mutually exclusive option shapes, checked at the call site |
| Constructor overloads for variant option shapes | `constructor(o: MarkerElementOptions); constructor(o: MarkerSVGOptions);` | the right autocomplete per usage |
| `Pick`/`Omit` to derive sub-option types | `MarkerMinimizedOptions = Pick<BaseOptions, …>` | one definition, many views |
| `satisfies readonly (keyof T)[]` on key lists | `CUSTOM_ELEMENT_MINIMIZED_KEYS` | key lists stay in sync with the type |
| Generic keyed accessors | `setProp<K extends keyof Props>(k: K, v: Props[K])` | one setter, full type safety |

`any` is a lint warning, not an error; where it appears (mirroring MapLibre signatures such as
`setPaintProperty`) it is left in place deliberately. External/untrusted data (style metadata,
fetched JSON) is typed optimistically and then **checked at runtime anyway**, with a comment
saying so.

---

## 7. Options, defaults and precedence

Every configurable feature follows the same resolution order:

```
explicit constructor / method option
        ↓ (if absent)
value declared in the style's metadata.maptiler.<feature>
        ↓ (if absent)
built-in default (constants/defaults.ts or a module-level DEFAULT_* const)
```

`extractCustomLayerStyle.ts` implements the style-metadata half of this for `space` and `halo`.

Conventions for option shapes:

- **`boolean | Options`**: `true` means "on, with defaults", `false` means off, an object means
  "on, configured". See `space`, `halo`, `minimap`.
- **`boolean | ControlPosition`**: `true` uses the default corner, a string places it. See every
  `*Control` option in `MapOptions`.
- Defaults are applied with `??`, never `||`.
- Option resolution for a complex feature is factored into a documented `configureOptions()`
  function with the precedence rules written out in its TSDoc `@remarks`.
- A method that changes configuration **overwrites** rather than merges, and says so in TSDoc
  (`Map.setSpace`: *"This method, at present, **overwrites** the current config"*).
- Experimental APIs are prefixed `experimental_` and tagged `@experimental` in TSDoc, with an
  `@remarks` note about cost (e.g. API-key quota usage).

---

## 8. Lifecycle and events

Getting this right is the single most common source of bugs in this codebase, so the rules are
explicit.

### 8.1 The event ladder

| Event | Meaning |
|---|---|
| `styledata` | Fires **many times** per style load. Handlers must be idempotent and cheap, and should early-out on a "nothing changed" check (`MarkerManager` compares the style id). |
| `style.load` | The style is parsed. Custom layers may now be added. |
| `load` | MapLibre's first render is done. |
| `ready` | **SDK-specific.** All controls the constructor manages are in place — this is *after* `load` because some built-in controls resolve asynchronously. |
| `loadWithTerrain` | **SDK-specific.** Loaded *and* terrain is non-null for the first time. |
| `webglContextLost` | **SDK-specific.** Re-fired from the canvas event; `Map.recreate()` is the documented recovery. |

Every such event has a promise counterpart: `onLoadAsync()`, `onReadyAsync()`,
`onLoadWithTerrainAsync()`. They all follow the same shape — resolve immediately if the state is
already reached, otherwise resolve from `once(...)`. **Add one whenever you add a lifecycle
event.**

### 8.2 Style changes destroy everything

MapLibre removes *all* layers when a new style is set. Any custom layer, marker adornment or
style-derived state must therefore be **re-applied on style change**, and the re-apply path must
be idempotent:

```ts
if (this.space && !this.getLayer(this.space.id)) {
  this.addLayer(this.space, this.getLayersOrder()[0]);
}
```

Terrain, language, projection, space and halo all have such a re-application handler registered
in the constructor. If your feature adds anything to the style, it needs one too.

### 8.3 Ordering in the constructor

`Map`'s constructor establishes an order that must be preserved:

1. Log version, warn about WebGL, apply `apiKey`.
2. Normalise the style (`styleToStyle`) and **delete `style` from the super options** — otherwise
   `setStyle` runs as a child call of `super()` before instance fields exist. This is commented
   in place; do not "simplify" it.
3. `super(superOptions)`, then tag the container (`maptiler-map` class).
4. `this.setStyle(style)` explicitly.
5. Register lifecycle handlers (`style.load`, `error`, `styledata`, `once("load")`).
6. Construct sub-systems last (`this.telemetry = new Telemetry(this)`).

Anything needing the map to exist goes inside `once("load")`; anything needing a parsed style
goes inside `style.load`; anything needing to survive style swaps goes in `styledata`.

### 8.4 Firing custom events

Use `this.fire("<name>", payload)` with a payload type exported from the module
(`LoadWithTerrainEvent`, `MarkerCollisionEventData`). Event names are lowercase, unspaced
(`markeroverlap`, `markerproximity`, `loadWithTerrain` is the historical exception).
**State-change events are diffed before firing** — emit on enter/exit, never re-emit an unchanged
state.

### 8.5 Promises in event handlers

MapLibre's `on`/`once` return values and async handlers trip the lint rules, so the codebase uses
`void this.once(...)` and, where an async callback is genuinely needed, a narrowly-scoped
`// eslint-disable-next-line @typescript-eslint/no-misused-promises`. Follow the local pattern
rather than widening lint config.

---

## 9. Performance conventions

Performance work is concentrated where it matters (per-frame paths) and is explicitly documented
in comments. The recurring techniques:

- **One `requestAnimationFrame` per frame per manager**, never per instance.
- **`WeakMap`/`WeakSet` for per-map and per-instance state**, so lifetimes are automatic.
- **No DOM reads during a pass.** Geometry comes from stored props plus static lookup tables
  (`SIZE_PX`, `SHAPES`). One-off measurements are cached at registration.
- **Broad-phase before narrow-phase.** Collision detection tests inflated AABBs before the exact
  oriented-box SAT, and skips the SAT entirely when a box is axis-aligned (`rotated: false`).
- **Viewport culling with a margin** (`VIEWPORT_CULL_MARGIN_PX`) so edge behaviour does not churn
  while panning.
- **Leave rendering entirely when invisible** (`display: none` after a fade completes) so large
  hidden populations cost nothing per frame.
- **Memoize network/GPU resources** and provide an explicit delete (`loadCubemapTexture` /
  `deleteMemoizedTexture`).
- **Idempotent appliers**: re-applying the current state is a no-op and returns early, so
  unchanged objects cost nothing per pass.

Whenever you use one of these, state *why* in a comment — that is the house style, and every hot
path in the repo carries one.

---

## 10. DOM and CSS

- SDK-owned elements are tagged with a `maptiler-` prefixed class
  (`maptiler-map`, `maptiler-marker-collision-fade`). MapLibre's own classes are never renamed.
- Visual parameters that consumers may want to restyle are exposed as **CSS custom properties**
  (`--marker-inner-color`, `--marker-shadow`, and the live map state variables
  `--maptiler-zoom`, `--maptiler-center-lng`, … set on the container for declarative controls).
- Elements are created with `document.createElement` / `createElementNS` (`SVG_NS`) — no
  `innerHTML` for structure, no templating library.
- Transform composition goes through `data-*` attributes plus a single builder function, so
  scale/rotation writes never clobber each other.
- The stylesheet is `src/style/style_template.css`. Icons are referenced as
  `url([src/style/svg/<file>.svg])`; `scripts/replace-path-with-content.js` inlines them as
  URL-encoded data URIs at build time, and the result is concatenated **after**
  `maplibre-gl.css` into `dist/maptiler-sdk.css`. **The SDK never fetches CSS or icons at
  runtime.** Adding an icon = drop the SVG in `src/style/svg/` and reference it with the bracket
  syntax.

---

## 11. Errors, warnings and resilience

- **Constructors and public methods do not throw for user input.** They `console.warn` and
  degrade: no API key → warn; unloadable style → warn and fall back to `MapStyle.STREETS` (or
  keep the current style if there is one); no WebGL → warn banner.
- `throw` is reserved for programmer errors that cannot be recovered from (e.g. an invalid
  cubemap preset name).
- Console messages are prefixed with the emitting unit in square brackets:
  `"[Map.setStyle]: …"`, `"[CubemapLayer]: …"`, `"[webglcontextlost]"`.
- Development-only diagnostics are gated on the build-time define:
  ```ts
  if (__MT_NODE_ENV__ === "development") console.warn("[extractCustomLayerStyle]: …");
  ```
- Network failures use `FetchError` (`src/utils/errors.ts`), which carries `status`, `statusText`
  and a `[module]` prefixed message.
- Telemetry and other non-essential side effects are wrapped in `try { … } catch {}` with a
  comment — they must never break the map.
- Errors from MapLibre are inspected rather than swallowed: the `error` handler distinguishes
  `AJAXError` (known URL → style fallback) from generic errors during style loading (probable
  CORS → style fallback), tracked via the `styleInProcess` / `monitoredStyleUrls` state.

---

## 12. Browser compatibility and dependencies

- `browserslist` is `["defaults", "not op_mini all"]` and is enforced in lint by
  **`eslint-plugin-compat`** (`compat/compat: "error"`). If you use a newer web API, either
  polyfill it in `src/polyfills.ts` and add it to the ESLint `settings.polyfills` list (as was
  done for `requestIdleCallback`), or don't use it.
- **`maplibre-gl` must be imported as a default import.** A custom ESLint rule
  (`import/default-imports-only`) enforces this repo-wide: MapLibre ships CJS and named imports
  break on some bundlers. Type imports are exempt:
  ```ts
  import maplibregl from "maplibre-gl";
  import type { Map as MapMLGL, MarkerOptions } from "maplibre-gl";
  ```
- Runtime dependencies are kept few and deliberate: `maplibre-gl`, `@maptiler/client`,
  `@maplibre/maplibre-gl-style-spec`, `gl-matrix`, `js-base64`, `uuid`, `events`. Adding one is a
  reviewed decision, and it must be added to the `external` list in `vite.config-es.ts` if it
  should not be bundled into the ESM build.
- Prefer a `src/utils/` function over a new dependency for anything small.

---

## 13. Documentation and comments

**TSDoc on every exported symbol.** Options, type members, public methods and event payloads all
carry a description; complex ones add `@remarks`, `@example`, `@param`, `@returns`,
`@experimental`, and `{@link Other}` cross-references. The published API reference is generated
from these by TypeDoc (`npm run doc`, config in `typedoc.json` + `typedoc.css`).

Inline comments explain **why**, not what — and this codebase leans heavily on them for:
- non-obvious ordering constraints (`// Removing the style option from the super constructor so that …`)
- algorithmic decisions (`// dedup vs seen, else judged-rejected findings reappear`)
- deliberate deviations from a lint rule or a type
- MapLibre quirks being worked around (`// ML swallows focus events on clicked elements`)

Other conventions:
- Long files are divided with `//#region <Name>` / `//#endregion` blocks (used in `Marker.ts`,
  `types.ts`, `MarkerManager.ts`, and mirrored in test files).
- Unimplemented or deferred API is either commented out under a `//#region Pending features`
  block or marked `TODO:` in the TSDoc so it surfaces in the generated docs.
- `README.md` is the user-facing manual (~2500 lines, feature-by-feature with runnable
  snippets). A user-visible feature is not done until it has a README section.

---

## 14. Testing

Three layers, each with a clear remit.

### 14.1 Unit tests — Vitest (`test/`, `npm run test`)

- Config: `vite.config-test.ts`, environment `happy-dom`, globals on, `@vitest/web-worker`
  loaded, setup in `vitest-setup-tests.ts` (which installs an `ImageData` global and a snapshot
  serialiser that fixes numbers to 10 decimals so floating-point noise does not break CI).
- Files mirror the source tree: `test/tile-preloading/tile-math.test.ts` for
  `src/tile-preloading/tile-math.ts`.
- Structure: `describe("<functionName>")` per exported function, `it("<behaviour in plain
  English>")` per case, grouped with `//#region` markers.
- What is unit-tested here: **pure logic** — maths, geometry, parsers, converters, animation
  helpers, caching, and the public export surface. DOM/GPU-heavy classes are covered by e2e.
- Fixtures live in `test/fixtures/`, as input/expected pairs (`x.kml` + `x.kml.geojson`).

### 14.2 The export test

`test/exports.test.ts` is a guard on the public API (see §4.3). Treat a failure as a design
question, not a chore.

### 14.3 End-to-end — Playwright (`e2e/`, `npm run e2e:ci`)

- `e2e/public/<name>.html` + `e2e/src/<name>.ts` build a fixture page; `e2e/tests/<name>.test.ts`
  drives it; helpers in `e2e/tests/helpers/` (`loadFixtureAndGetMapHandle`,
  `injectGlobalVariables`, `getMapInstanceForFixture`) hide the boilerplate.
- Network is mocked from `e2e/tests/mocks/` (style JSON, tiles) so runs are deterministic.
- Assertions are largely **visual snapshots** (`expect(page).toHaveScreenshot()`), stored in
  `e2e/snapshots/` per platform (`-chromium-linux` is the CI baseline).
- Chromium only; other browsers are configured but commented out.
- Snapshots are regenerated in CI by commenting `/update-snapshots` on the PR (owner/member
  only), which runs `e2e:ci-update` and commits the result as the testbot.

### 14.4 What to test for a new feature

| Kind of code | Where it is tested |
|---|---|
| Pure functions, maths, parsing | Vitest unit test, table-driven |
| New/changed public export | `test/exports.test.ts` list + snapshot |
| Rendering, WebGL layers, style interactions | Playwright fixture + screenshot |
| Interactive DOM behaviour | Playwright, plus a demo page for manual verification |

---

## 15. Demos

`demos/` is a Vite app (`npm run dev`) with one numbered demo per feature:
`demos/public/NN-name.html` + `demos/src/NN-name.ts`, sharing `demo-styles.css` and
`demo-utils.ts` (`setupMapTilerApiKey`, `addPerformanceStats`). `XX-scratch-pad.html` is the
throwaway page.

Demos import from `../../src/index` (source, not `dist`) and link `../build/maptiler-sdk.css`.
**A user-visible feature ships with a demo**; the demo is how reviewers and QA exercise it, and
several demos double as the manual test plan for behaviour that screenshots cannot capture
(collision, UI states, language switching).

---

## 16. Tooling, formatting, build and release

### 16.1 Formatting and linting

- **Prettier via ESLint** (`eslint-plugin-prettier/recommended`). There is no `.prettierrc`;
  formatting comes from Prettier defaults plus `.editorconfig`: 2-space indent, LF, UTF-8,
  final newline, **max line length 180**. Long single-line expressions are normal here.
- ESLint runs the **type-checked** typescript-eslint configs (`strictTypeChecked`,
  `stylisticTypeChecked`, `recommendedTypeChecked`) with a large block of rules downgraded to
  `warn` (see `eslint.config.mjs`). Errors that remain: `compat/compat`,
  `import/default-imports-only`, `unified-signatures`.
- `npm run lint` = `tsc --noEmit && eslint src`. `npm run lint:fix` adds `--fix`.
- **Pre-commit (husky)** runs `lint-staged` (→ `lint:fix` on staged `.ts`), a typecheck, and the
  full unit test suite. Commits are expected to be green locally.

### 16.2 Build outputs

| Script | Output | Notes |
|---|---|---|
| `build-es` | `dist/maptiler-sdk.mjs` + `dist/maptiler-sdk.d.ts` | ESM; deps externalised; types via `vite-plugin-dts`; `eslint.config.mjs` copied to `dist/eslint.mjs` |
| `build-umd` | `build/maptiler-sdk.umd.min.js` | UMD for CDN; everything bundled |
| `build-css` | `dist/maptiler-sdk.css` (+ copy in `build/`) | SVG inlining, then concatenated after `maplibre-gl.css` |
| `build` / `make` | all three | what CI runs |

Both JS builds inject `__MT_SDK_VERSION__` and `__MT_NODE_ENV__` via Vite `define` (declared in
`src/declarations.d.ts`). Never import `package.json` at runtime.

The npm package publishes **`dist/` only**, with an `exports` map exposing the module, the types
and the stylesheet (`@maptiler/sdk/style.css`).

### 16.3 CI (`.github/workflows/`)

| Workflow | Trigger | Does |
|---|---|---|
| `format-lint.yml` | PR to `main`/`next` | `npm run lint` + `tsc --noEmit` |
| `unit-tests.yml` | PR touching `src/**` or configs | `npm run test` |
| `e2e.yml` | PR touching `e2e/**`, `src/**`, configs | Playwright (chromium), uploads report, comments on the PR when it fails, dispatches to the external `maptiler-sdk-e2e-testing` repo |
| `npm-pack-dry-run.yml` | every PR | `npm run make` + `npm pack --dry-run` |
| `npm-publish.yml` | GitHub release created | build, `npm publish` (`--tag next` for prereleases), upload `build/` to the Cloudflare R2 CDN under `maptiler-sdk-js/v<version>/`, dispatch downstream e2e |
| `update-snapshots.yml` | `/update-snapshots` PR comment | regenerates and commits Playwright snapshots |

---

## 17. Delivering a change

### 17.1 Git workflow

- Branches are named after the tracker ticket: `RD-1397-markers`, `RD-1407-collision-logic-II`.
  Non-ticket work uses `hotfix/<slug>` or `release/<version>`.
- Commit subjects start with the ticket or branch slug and describe the change:
  `RD-1405 ML swallows focus events on clicked elements. We need to explicitly handle …`.
  Longer commits use a bulleted body listing what was added/fixed/renamed.
- Feature branches usually target `next` (integration) and land on `main` at release time; large
  features use a long-lived parent branch (`RD-1397-markers`) with sub-branches merged into it.
- PRs use `.github/pull_request_template.md`: **Objective / Description / Acceptance /
  Checklist**, and the checklist item is *"I have added relevant info to the CHANGELOG.md"*.

### 17.2 CHANGELOG

`CHANGELOG.md` is maintained by hand. Unreleased work goes under `## NEXT` in one of the fixed
sections, in this order:

```
## NEXT
### ⚠️ Breaking changes      (only when relevant)
### ✨ Features and improvements
### 🐛 Bug Fixes
### ⚙️ Others
```

Entries are user-facing sentences, mention the public API names involved, and link the Jira
ticket when one exists. Dependency bumps go under **Others**. At release, `NEXT` is renamed to
the version number and a fresh empty `NEXT` is added.

### 17.3 Checklist for "extend feature XYZ"

1. **Locate the archetype.** Is it a MapLibre class re-typing (`MLAdapters/`), a control
   (`controls/`), a WebGL layer (`custom-layers/<Name>/`), a feature module (`src/<Feature>/`),
   a helper (`helpers/`), or a pure function (`utils/`)? Match the existing folder shape.
2. **Model the options first**, in the feature's `types.ts`: derive from MapLibre types where
   possible, use the `boolean | Options` idiom, TSDoc every field, and decide the
   option → style-metadata → default precedence.
3. **Implement the logic in the module**, not in `Map.ts`. Add a manager only if instances need
   coordinating; if you do, use WeakMaps + one rAF flush.
4. **Wire `Map`** with the minimum: option parsing in the constructor, delegating public methods
   with TSDoc, and lifecycle handlers — including a **re-apply-on-style-change** handler if the
   feature adds anything to the style.
5. **Handle the failure paths**: warn-and-degrade, prefixed console messages, dev-only
   diagnostics behind `__MT_NODE_ENV__`, `try/catch` around non-essential side effects.
6. **Export deliberately** from the feature barrel and then from `src/index.ts`, splitting
   `export type` from value exports.
7. **Update `test/exports.test.ts`** (list + snapshot) if the public surface changed.
8. **Test**: unit tests for pure logic; a Playwright fixture + screenshot for anything rendered;
   a numbered demo for anything interactive.
9. **Document**: TSDoc (feeds TypeDoc), a `README.md` section for user-visible features, and a
   `CHANGELOG.md` entry under `NEXT`.
10. **Run the gates locally**: `npm run lint`, `npm run test`, and `npm run e2e:ci` when
    rendering changed. The pre-commit hook runs lint + typecheck + unit tests anyway.
11. **Open the PR** against `next` (or the parent feature branch) with the template filled in.

### 17.4 Notes for coding agents

- The build is source-of-truth-driven: never edit anything under `dist/` or `build/`; they are
  generated.
- Do not add `export *` from `@maptiler/client` or from internal helper files — the export test
  will fail and the public surface is curated.
- Do not "clean up" the constructor ordering in `Map.ts`, the `delete superOptions.style` line,
  the `void this.once(...)` calls, or the inline `eslint-disable` comments: each is load-bearing
  and commented.
- Prefer extending an existing lookup table / const map over adding a branch in a hot path.
- When touching `Marker`, remember the three-way ownership of visual props (user props, minimized
  overrides, UI states) and the masking rules in `FlushDOMUpdatesSymbol` — write to the DOM
  directly for transient state, through `setProp` for user state.
- E2E screenshots are platform-specific; a local run on macOS will not match the
  `-chromium-linux` baselines. Regenerate via the `/update-snapshots` PR comment, not by
  committing local `-darwin` snapshots.

---

## 18. Standards being raised

Everything above describes the codebase as it is. This section is different: it lists places
where the *practice* has drifted from the *principle*, and states the standard we hold new code
to going forward.

**None of these change the foundational architecture.** Extending MapLibre rather than forking
it, `Map` as a facade, the curated export surface, warn-and-degrade, batched DOM writes,
option → style-metadata → default precedence — all of that stays exactly as described. What
follows tightens the standards *around* those principles.

Each item is written as: **observation → the standard → how it is enforced**. Items are ordered
by how much they cost the next person to touch the code.

### 18.1 The lint gate must be green, and warnings must not accumulate

**Observation.** `npm run lint` currently reports **2 errors** (`prettier/prettier`, in
`src/Marker/MarkerManager.ts`) and **235 warnings** across `src/`. The errors mean the
`format-lint` CI job fails as things stand. They reached `main`-bound history through **merge
commits, which bypass the husky pre-commit hook** — the hook only sees `lint-staged` files on
normal commits. The warnings are concentrated in `Map.ts` (42) and `converters/xml.ts` (40), and
by rule in `no-unnecessary-condition` (81), `no-non-null-assertion` (23),
`restrict-template-expressions` (21), `no-unsafe-member-access` (20), `no-floating-promises`
(19), `no-explicit-any` (16), `no-unused-vars` (16).

**The standard.**
- A branch is not ready for review while `npm run lint` reports an error. Run it before opening
  the PR — the pre-commit hook is a convenience, not the gate, and it does not run on merges.
- **Leave a file no warmer than you found it.** Any file you touch should come out with the same
  number of lint warnings or fewer. New code adds none.
- The `warn` severities in `eslint.config.mjs` exist so that a large legacy surface did not have
  to be fixed at once. They are not permission to write new warning-producing code.
- Where a warning is genuinely correct to keep (mirroring a MapLibre `any`, an unavoidable
  floating promise), silence it **locally** with a targeted `// eslint-disable-next-line <rule>`
  plus a one-line reason — the pattern already used ~16 times in `src/`. A disable comment with a
  reason is reviewable; a warning in the pile is not.
- Do not widen a rule's severity in `eslint.config.mjs` to make your branch pass.

**Enforcement.** The intended end state is `eslint src --max-warnings <N>` in the `lint` script
with `N` ratcheted down as debt is paid, so the count can never grow. Until that lands, it is a
review responsibility: a PR that raises the warning count in a file it touches gets a change
request.

### 18.2 Pure logic ships with unit tests

**Observation.** The test layering in §14 is sound, but coverage of the newest and most
algorithmic module is the thinnest. `src/Marker/` is **11 files / ~3,700 lines with no unit
tests**, including `collision-helpers.ts` (OBB/AABB intersection, SAT, connected-component
grouping, priority resolution) and `marker-state-helpers.ts` — which are pure, deterministic,
input→output functions and are the easiest code in the repo to test. `src/utils/` and
`src/controls/` also have no unit tests. By contrast `tile-preloading/`, `MaptilerAnimation/` and
`converters/` are well covered, and `test/tile-preloading/tile-math.test.ts` is the model to
copy.

**The standard.**
- **Every pure function gets a unit test in the same commit.** "Pure" means: no DOM, no network,
  no map instance — geometry, maths, parsing, sorting, resolution rules, state flattening.
- If a function is hard to unit-test, that is a signal to split it: extract the decision from the
  effect. `resolveDisplayStates` (decision) being separate from `applyCollisionDisplayState`
  (effect) is the pattern that makes this easy — keep doing it, and then test the decision half.
- Table-driven `describe(<functionName>) / it(<behaviour>)` with `//#region` grouping, as in
  `tile-math.test.ts`.
- Screenshot tests remain for rendering; they do not substitute for unit tests of the logic that
  decides what to render.

**Enforcement.** Review: a PR adding a `*-helpers.ts` file without a matching
`test/**/<same-name>.test.ts` gets a change request. Backfilling `collision-helpers.ts` is the
first debt item.

### 18.3 One vocabulary in the public API

**Observation.** The public surface mixes British and American spelling:
`collisionBehaviour`, `CollisionBehaviour`, `MapTilerMarkerBehaviourOptions` (British) sit
alongside `color`, `innerColor`, `minimizedOptions`, `MINIMIZE_BY_PRIORITY` (American), and the
TSDoc prose uses "colour" while the property it documents is `color`.

**The standard.**
- **American spelling for all identifiers** — types, properties, methods, event names, enum
  values. This is what MapLibre and the web platform use (`color`, `center`, `behavior`), and a
  consumer should never have to remember which of our keys is spelled which way.
- **American spelling in TSDoc prose too**, so docs and the symbols they describe match.
- Existing British-spelled public names stay as they are until a major version — renaming them is
  a breaking change and belongs in a deliberate `⚠️ Breaking changes` entry, not in a feature PR.
  New API added next to them still uses American spelling; a short-lived inconsistency is better
  than a permanent one.

**Enforcement.** Review, plus §18.7's spellcheck step.

### 18.4 Shared constants have one source of truth

**Observation.** The 150 ms collision fade exists three times: `COLLISION_FADE_DURATION_MS = 150`
in `marker-dom-utils.ts`, and two `150ms` literals in `style_template.css`. The timers that
sequence the fade (`minimizeSwapTimer`, `cullTimer`, `fadeClassReleaseTimer`) all depend on the
TS value matching the CSS value; nothing enforces that. Separately, `Map` compares configuration
objects with `JSON.stringify(a) === JSON.stringify(b)` (10 `JSON.stringify` call sites in `src/`),
which is **key-order sensitive** — two equivalent configs written in a different key order compare
as different and cause a redundant layer rebuild. The repo already has `orderObjectKeys()` in
`utils/object.ts` for exactly this, and `CubemapLayer` uses it; `Map.setSpaceFromStyle` /
`setHaloFromStyle` do not.

**The standard.**
- A value that must agree between TS and CSS is **declared once**. Prefer expressing it as a CSS
  custom property that the TS reads, or generating the CSS value from the TS constant in the
  build. When neither is practical, the two sites carry reciprocal comments naming each other,
  and the constant name appears in the CSS comment.
- **Never compare objects with `JSON.stringify` unless the keys are known to be ordered.** Use
  `orderObjectKeys()` first, or a small structural-equality helper in `utils/`. If you find
  yourself deep-comparing config to decide whether to rebuild, prefer an explicit dirty flag.
- Magic numbers that encode a timing or a threshold get a named `const` with a comment, in the
  module that owns the behaviour (`VIEWPORT_CULL_MARGIN_PX` is the model).

### 18.5 `Map.ts` keeps shrinking, not growing

**Observation.** §3.2 states the principle — `Map` is a facade — and `Map` follows it for markers,
tile preloading and telemetry. It does not follow it for terrain, language and the space/halo
layers: `enableTerrain` / `disableTerrain` / `growTerrain`, the language resolution and label
rewriting, and `initSpace` / `initHalo` / `setSpaceFromStyle` / `setHaloFromStyle` are implemented
inline. `Map.ts` is 2,507 lines and carries 42 of the 235 lint warnings. The space and halo paths
are near-duplicates of each other, differing mainly in insertion index.

**The standard.**
- **New feature logic never lands inline in `Map.ts`.** `Map` gains option parsing, delegating
  public methods with TSDoc, and lifecycle wiring — nothing more. This is already the rule in
  §3.2; it is repeated here because the exceptions are what a newcomer sees first.
- When you modify one of the inline subsystems substantially, **extract it** into a feature module
  in the archetype of §5 (`src/Terrain/`, `src/Language/`) as part of that work, rather than
  adding to the inline version. Extraction is a refactor with tests, done in its own commit,
  separate from the behaviour change.
- Two subsystems that differ only in a parameter (space/halo) should share one implementation
  parameterised by that difference — a "style-metadata-driven custom layer" abstraction — rather
  than being maintained as parallel copies.
- Soft ceiling: a file over ~800 lines is a prompt to split by responsibility. `Marker/` shows the
  target shape — a class file plus focused `-dom-utils`, `-helpers`, `-config`, `-registry`
  siblings.

### 18.6 Every public symbol is documented before it ships

**Observation.** TSDoc coverage is high and genuinely good on `MapOptions`, `Marker/types.ts` and
the collision engine. The gaps are on recently added public methods: `Map.addMarker` carries
`/** TODO document this */`, and `removeMarker` / `addMarkers` / `removeMarkers` / `getMarkers` /
`getMarker` carry none — while the module's own internals are documented in detail. There are 16
`TODO`s in `src/`, some of which describe unimplemented public options (`visible`, `icon`) that
are already visible in the typed API.

**The standard.**
- **A public export is not done until it has TSDoc**: a summary line, `@param`/`@returns` where
  non-obvious, and `{@link}` to related API. These feed the published TypeDoc reference, so an
  undocumented export is a hole in the product, not just in the source.
- A public option that is typed but not implemented must say so in its own TSDoc (`TODO: not
  implemented yet` — as `visible` and `icon` already do), so the gap is visible in the generated
  docs and not just in the code.
- `TODO` comments carry an owner or a ticket: `// TODO(RD-1234): …`. A bare `TODO` in a public
  docblock is a documentation defect.
- Prefer *not* exporting a type until the feature behind it works; the export test (§4.3) makes
  adding it later cheap and explicit.

### 18.7 Naming and spelling hygiene

**Observation.** Several identifiers and strings carry typos that have propagated:
`curentProjection` (5 uses in `Map.ts`), `clearnUrlStr`, `providedlanguage`, plus docblock and
user-visible message typos — `"Keeping the curent style instead."` is printed to consumers'
consoles, and `config.ts` documents "MapTiler sesion ID" and "Get the fetch fucntion". One test
file is named `vectorlayerhepers.test.ts`.

**The standard.**
- **Identifiers and user-visible strings are spellchecked.** Console messages are product surface:
  they are read by consumers debugging their app, and they get quoted in support tickets.
- Fix a typo'd identifier when you are already editing that code — it is a private field rename,
  not a breaking change. Do not do a repo-wide rename sweep inside a feature PR; that belongs in
  its own commit.
- Test files mirror their source file name exactly, so the pairing is mechanical.
- Keep the existing message shape: `"[Unit.method]: <what happened>. <what the SDK did instead>."`
  — the two-sentence form (problem + fallback) is what makes warn-and-degrade legible, and it
  should stay consistent.

### 18.8 Build defines mean the same thing in every config

**Observation.** `__MT_NODE_ENV__` is declared as `string` and compared against `"development"`
in `extractCustomLayerStyle.ts` and `CubemapLayer.ts`. Four of the five Vite configs inject
`JSON.stringify(process.env.NODE_ENV)` (→ `"development"` / `"production"`), but
`vite.config-test.ts` injects `JSON.stringify(process.env.NODE_ENV === "development")` (→ the
string `"true"` / `"false"`). Under Vitest the dev-only diagnostics can therefore never fire, and
the declared type hides the mismatch.

**The standard.**
- A build-time define has **one meaning and one shape across every config** — `vite.config-dev`,
  `-es`, `-umd`, `-e2e`, `-test`, and the Playwright `launchOptions.env`. Adding a define means
  adding it to all of them in the same commit.
- Type defines in `src/declarations.d.ts` as narrowly as possible (`"development" | "production"`
  rather than `string`) so a mismatch is a type error rather than a silent dead branch.
- Dev-only code paths get at least one test that proves they are reachable in the test
  environment, or they are not worth having.

### 18.9 E2E assertions are specific, and snapshots stay tidy

**Observation.** The Playwright layer is deterministic (mocked tiles and styles) and that is
right. But nearly every assertion is a full-page screenshot, so a failure says "pixels differ"
rather than "the halo did not re-attach after the style change". Baselines are duplicated across
test directories — the same `halo-*` and `space-*` images exist under `map-load.test.ts-snapshots`,
`rtlTextPlugin.test.ts-snapshots` and `haloSpace.test.ts-snapshots` — and a few `-chromium`
(non-linux) baselines linger alongside the `-chromium-linux` CI ones. Only Chromium runs.

**The standard.**
- **Pair every screenshot with at least one specific assertion** — a DOM query, a
  `map.getLayer(...)` evaluation, an event fired, a computed style. The screenshot catches
  regressions nobody predicted; the specific assertion tells the next person what broke.
- One canonical baseline location per behaviour. If two tests need the same visual, they share a
  fixture rather than each growing a copy.
- Delete stale baselines in the PR that makes them stale; a `-chromium` file next to a
  `-chromium-linux` file is dead weight that will eventually be trusted by mistake.
- Regenerate through `/update-snapshots` (§14.3). Committing locally-generated `-darwin`
  baselines is never correct.

### 18.10 Prefer replacing an instance over mutating its identity

**Observation.** `Map.recreate()` (the documented WebGL-context-loss recovery) does
`this.remove()` followed by `Object.assign(this, new Map({ ...this.options }))` — it constructs a
second map and copies its fields onto the first, so the caller's reference survives. Every
listener, WeakMap entry and sub-system holding the old instance now points at an object whose
internals were swapped underneath it.

**The standard.**
- New API does **not** mutate object identity to fake a rebuild. Return a new instance and let the
  caller rebind, or provide an explicit `dispose()` + re-construct flow.
- Sub-systems that key state off a `Map` (the WeakMaps in `MarkerManager`, per-map collision
  state, `lastStyleId`) must be considered whenever a map is torn down or rebuilt — write down in
  the PR which of them survive the operation and which are intentionally dropped.
- `recreate()` itself stays as-is for now: it is public API with documented behaviour. Treat it as
  a known sharp edge to work *around*, not a pattern to copy.

### 18.11 The `options` snapshot is not the current state

**Observation.** `Marker.options` is a `readonly` construction-time snapshot, and its docblock
correctly says setters do not update it — but `Marker` then reads `this.options.*` internally in
several places (`collisionRadius`, `anchor`, `element`, `minimizedOptions`) while reading
`this.props.*` in others. The split is correct today because those particular keys have no
setters; it becomes a bug the moment one gains one.

**The standard.**
- **`props` is the current state; `options` is history.** Internal code reads `props` (or a
  getter) unless it specifically needs the construction-time value, and where it reads `options`
  the reason is stated in a comment.
- Adding a setter for a key means moving that key into `props` in the same change, and auditing
  every `this.options.<key>` read.
- The same rule applies to `Map.options`, which is written back by `setSpace`/`setHalo`.

### 18.12 Small standing conventions

- **Merge commits skip hooks.** After merging a parent branch into yours, re-run
  `npm run lint && npm run test` before pushing.
- **`console` usage is a public interface.** There are 55 `console.*` calls in `src/`. New ones
  are `warn` (recoverable) or `info` (lifecycle, once per map at most) — never `log`, and never in
  a per-frame path. Debug output is removed before review, not commented out.
- **`export *` is for feature barrels only** — never for `@maptiler/client` re-exports, never
  across module boundaries where it would leak internals into `src/index.ts`.
- **Keep the export test list and the snapshot in sync in one commit**; they are two views of one
  decision, and a PR that updates only one of them is incomplete.
- **Demos are maintained, not accreted.** When a feature changes, update its numbered demo in the
  same PR; `XX-scratch-pad.html` is the only page allowed to be throwaway.
