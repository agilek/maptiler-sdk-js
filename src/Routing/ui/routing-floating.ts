/** Gap between an anchor and the thing that opens under it. */
export const FLOATING_GAP = 4;

/** How close to the edge of the viewport a floating element may come. */
const VIEWPORT_MARGIN = 8;

/**
 * Places an element under its anchor, in viewport coordinates.
 *
 * Everything the panel opens — the filter menus, the search results — has to
 * escape the panel body, which scrolls and would otherwise clip it. That means
 * `position: fixed`, and fixed positioning needs two corrections:
 *
 * - MapLibre gives every `.maplibregl-ctrl` a `transform: translate(0)`, which
 *   makes the control root, not the viewport, the containing block. Rather
 *   than guess which ancestor that is, the element is parked at the origin and
 *   measured: wherever it lands is what the coordinates below are relative to.
 * - The panel can sit against any edge of the map, so an element wider or
 *   taller than the room left is pushed back inside — and opens upwards when
 *   there is more room above its anchor than below.
 *
 * @param anchor - What it opens from.
 * @param floater - The element to place. Must already be visible; a hidden
 * element has no size to measure.
 * @param matchAnchorWidth - `true` to size it to the anchor, which is what a
 * result list under a field wants; menus only take it as a minimum.
 */
export function placeFloating(anchor: HTMLElement, floater: HTMLElement, matchAnchorWidth = false): void {
  const anchorRect = anchor.getBoundingClientRect();

  if (matchAnchorWidth) floater.style.width = `${anchorRect.width.toString()}px`;
  else floater.style.minWidth = `${anchorRect.width.toString()}px`;

  floater.style.left = "0px";
  floater.style.top = "0px";
  const origin = floater.getBoundingClientRect();

  let left = anchorRect.left;
  if (left + origin.width > window.innerWidth - VIEWPORT_MARGIN) {
    left = Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - origin.width);
  }

  let top = anchorRect.bottom + FLOATING_GAP;
  if (top + origin.height > window.innerHeight - VIEWPORT_MARGIN && anchorRect.top > window.innerHeight - anchorRect.bottom) {
    top = Math.max(VIEWPORT_MARGIN, anchorRect.top - FLOATING_GAP - origin.height);
  }

  floater.style.left = `${(left - origin.left).toString()}px`;
  floater.style.top = `${(top - origin.top).toString()}px`;
}
