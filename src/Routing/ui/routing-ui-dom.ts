import { RC } from "./routing-ui-defaults";

/**
 * Creates an element with a class and optional text.
 *
 * A thin wrapper over `createElement` so the views read as a tree. Structure is
 * always built from elements, never from `innerHTML`.
 */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/**
 * Creates an icon span.
 *
 * The icon itself comes from the stylesheet, selected by `data-icon`, so no SVG
 * is created in JavaScript and nothing is fetched at runtime.
 *
 * @param id - Icon id, written to `data-icon`.
 * @param maneuver - Raw maneuver kind, written to `data-maneuver` so a consumer
 * can style an icon for a kind the SDK does not know.
 */
export function icon(id: string, maneuver?: string): HTMLSpanElement {
  const element = el("span", RC.icon);
  element.dataset.icon = id;
  if (maneuver) element.dataset.maneuver = maneuver;
  element.setAttribute("aria-hidden", "true");
  return element;
}

/**
 * Creates a button.
 *
 * @param className - Class applied to the button.
 * @param label - Accessible name. Also the visible text unless `iconId` is
 * given, in which case the button is icon-only and the label becomes its
 * `aria-label`.
 * @param iconId - Icon to place inside the button.
 */
export function button(className: string, label: string, iconId?: string): HTMLButtonElement {
  const element = el("button", className);
  element.type = "button";

  if (iconId) {
    element.append(icon(iconId));
    element.setAttribute("aria-label", label);
    element.title = label;
  } else {
    element.textContent = label;
  }

  return element;
}

/** Sets or removes a boolean attribute, so `false` leaves no attribute behind. */
export function setBooleanAttribute(element: HTMLElement, name: string, value: boolean): void {
  if (value) element.setAttribute(name, "true");
  else element.removeAttribute(name);
}

/**
 * Sets or removes a `data-` flag, used to express state for CSS to select on.
 *
 * @param name - Attribute name without the `data-` prefix, in kebab-case.
 */
export function setDataFlag(element: HTMLElement, name: string, value: boolean): void {
  if (value) element.setAttribute(`data-${name}`, "");
  else element.removeAttribute(`data-${name}`);
}

/**
 * Coalesces DOM writes into one animation frame.
 *
 * Several state changes in the same tick (a response arriving, a selection
 * changing, a waypoint being edited) then cost one render rather than one each.
 */
export class RenderQueue {
  private frame: number | null = null;
  private readonly dirty = new Set<string>();
  private readonly flush: (regions: ReadonlySet<string>) => void;

  constructor(flush: (regions: ReadonlySet<string>) => void) {
    this.flush = flush;
  }

  /** Marks a region as needing a re-render on the next frame. */
  schedule(region: string): void {
    this.dirty.add(region);
    if (this.frame !== null) return;

    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const regions = new Set(this.dirty);
      this.dirty.clear();
      this.flush(regions);
    });
  }

  /** Cancels any pending frame. Called when the control is removed. */
  cancel(): void {
    if (this.frame === null) return;
    cancelAnimationFrame(this.frame);
    this.frame = null;
    this.dirty.clear();
  }
}
