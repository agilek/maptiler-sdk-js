# Hand-drawn routing icons (superseded — reference only)

These are the 27 icons drawn by hand while the routing control was being built, before the
Map Controls UI library was available to draw from.

**They are not used by the SDK.** The shipped icons live in `src/style/svg/routing-*.svg` and come
from the [Map Controls UI \[wip\]](https://www.figma.com/design/a6eqcecrSBrnxvGZGYx5a2/Map-Controls-UI--wip-)
Figma library. This folder is kept only so the two sets can be compared.

Nothing here is referenced by the stylesheet or the build, and nothing here is published: the npm
package ships `dist/` only.

## Contents

| Group | Files |
|---|---|
| Transport modes | `routing-mode-{car,truck,bicycle,pedestrian}.svg` |
| Interface | `routing-{drag,trash,add-circle,crosshair,route-start,route-stop,route-pin,chevron-up,chevron-down,chevron-left,chevron-right,download}.svg` |
| Maneuvers | `routing-maneuver-{continue,left,right,slight-left,slight-right,sharp-left,sharp-right,uturn-left,uturn-right,roundabout,start,destination}.svg` |

All are 24×24, `fill="none"` with `stroke="currentColor"` at 1.8, and were built to be used as CSS
masks — the same contract the design's icons now follow.

## What replaced them

Every one now comes from the Figma library, mostly one-for-one. Five ids changed, because the
design has a name (or an existing asset) for the thing and inventing a second one would have been
the mistake all over again:

| Hand-drawn id | Now | Source |
|---|---|---|
| `add-circle` | `plus` | `Icon` set, `Type=Plus` |
| `crosshair` | `my-location` | `Icon` set, `Type=MyLocation` — the same glyph the design's "select from map" row uses |
| `chevron-up` | `chevron-down`, rotated in CSS | the panel's own chevron |
| `maneuver-start` | `route-start` | `Icon` set, `Type=RoutingStart` |
| `maneuver-destination` | `route-pin` | `Pin` set, `Type=Pin, Active=True` |
