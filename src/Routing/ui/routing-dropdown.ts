import { placeFloating } from "./routing-floating";
import { RC } from "./routing-ui-defaults";
import { el, icon, setBooleanAttribute, setDataFlag } from "./routing-ui-dom";

/**
 * A filter dropdown: a pill that opens a panel below it.
 *
 * The design's filter row (RouteFilters) is made of these — one per filter,
 * each showing its current value and opening a small menu. The menu is a
 * `role="group"` rather than a `role="menu"`: several of them hold checkboxes
 * and number inputs, which a menu may not contain.
 *
 * The instance owns its open state and its outside-click listener, so a view
 * only has to build the content and call {@link setLabel} when the value
 * changes.
 */
export class Dropdown {
  /** Wrapper to place in the filter row. */
  readonly element: HTMLElement;

  /** Panel the caller fills with the filter's controls. */
  readonly menu: HTMLElement;

  private readonly toggle: HTMLButtonElement;
  private readonly text: HTMLSpanElement;
  private opened = false;

  /**
   * Closes the dropdown when the press lands anywhere else.
   *
   * `pointerdown` rather than `click`, so the menu is gone before a click on
   * something behind it is dispatched, and captured, so a handler that stops
   * propagation cannot leave the menu stuck open.
   */
  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    if (this.element.contains(event.target as Node)) return;
    this.close();
  };

  /**
   * Follows the pill when the panel scrolls under it.
   *
   * Closing would be simpler, but the panel scrolls by itself: switching an
   * avoidance replaces the results with placeholders, which changes the body's
   * height, which scrolls it — and the menu would vanish on the first switch
   * the user flicked. It closes only once its pill has been scrolled out of
   * the panel.
   */
  private readonly onScroll = (): void => {
    const parent = this.scrollParent();
    const anchor = this.toggle.getBoundingClientRect();

    if (parent) {
      const bounds = parent.getBoundingClientRect();
      if (anchor.bottom < bounds.top || anchor.top > bounds.bottom) {
        this.close();
        return;
      }
    }

    this.position();
  };

  constructor(label: string, ariaLabel: string) {
    this.element = el("div", RC.dropdown);

    this.text = el("span", RC.dropdownLabel, label);

    this.toggle = el("button", RC.dropdownToggle);
    this.toggle.type = "button";
    this.toggle.setAttribute("aria-haspopup", "true");
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.setAttribute("aria-label", ariaLabel);
    this.toggle.append(this.text, icon("chevron-down"));
    this.toggle.addEventListener("click", () => {
      this.setOpen(!this.opened);
    });

    this.menu = el("div", RC.dropdownMenu);
    this.menu.setAttribute("role", "group");
    this.menu.setAttribute("aria-label", ariaLabel);
    this.menu.hidden = true;

    this.element.append(this.toggle, this.menu);
    this.element.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.opened) return;
      event.stopPropagation();
      this.close();
      this.toggle.focus();
    });
  }

  /** Replaces the text shown on the pill. */
  setLabel(label: string): void {
    this.text.textContent = label;
  }

  /** `true` while the menu is showing. */
  isOpen(): boolean {
    return this.opened;
  }

  /** Closes the menu, if it is open. */
  close(): void {
    this.setOpen(false);
  }

  /** Drops the listeners it added outside itself. Called when the row is rebuilt. */
  destroy(): void {
    document.removeEventListener("pointerdown", this.onDocumentPointerDown, true);
    this.scrollParent()?.removeEventListener("scroll", this.onScroll);
  }

  private setOpen(open: boolean): void {
    if (this.opened === open) return;

    this.opened = open;
    this.menu.hidden = !open;
    setBooleanAttribute(this.toggle, "aria-expanded", open);

    if (open) {
      this.position();
      document.addEventListener("pointerdown", this.onDocumentPointerDown, true);
      // the panel body scrolls under a menu that is positioned against the
      // viewport, so the menu goes rather than drifting away from its pill
      this.scrollParent()?.addEventListener("scroll", this.onScroll, { passive: true });
      return;
    }

    document.removeEventListener("pointerdown", this.onDocumentPointerDown, true);
    this.scrollParent()?.removeEventListener("scroll", this.onScroll);
  }

  private position(): void {
    placeFloating(this.toggle, this.menu);
  }

  /** Nearest scrollable ancestor — the panel body, in practice. */
  private scrollParent(): HTMLElement | null {
    return this.element.closest<HTMLElement>(`.${RC.body}`);
  }
}

/**
 * A row of a dropdown menu: a label on the left, its control on the right.
 *
 * @param control - The control, or nothing for a row that is only a label —
 * which is how the design draws a list of choices.
 */
export function menuRow(label: string, control?: HTMLElement): HTMLLabelElement {
  const row = el("label", RC.dropdownRow);
  row.append(el("span", RC.dropdownRowLabel, label));
  if (control) row.append(control);
  return row;
}

/** The explanatory line the design puts at the foot of a menu. */
export function menuNote(text: string): HTMLParagraphElement {
  return el("p", RC.dropdownNote, text);
}

/**
 * A number entry for a menu row: the value, right-aligned and muted, followed
 * by its unit — the design shows no box around it.
 *
 * @param value - Current value, or `undefined` when the option is unset. Empty
 * means "let the service decide", which is not the same as zero.
 */
export function numberField(value: number | undefined, unit: string, min: number, step: number, onChange: (value: number | undefined) => void): HTMLElement {
  const wrapper = el("span", RC.dropdownValue);

  const input = el("input", RC.dropdownNumber);
  input.type = "number";
  input.min = min.toString();
  input.step = step.toString();
  input.value = value === undefined ? "" : value.toString();
  input.addEventListener("change", () => {
    onChange(input.value === "" ? undefined : Number(input.value));
  });

  wrapper.append(input, el("span", undefined, unit));
  return wrapper;
}

/** The design's 32×16 switch, which is a checkbox the stylesheet redraws. */
export function switchField(checked: boolean, onChange: (checked: boolean) => void): HTMLInputElement {
  const input = el("input", RC.switch);
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => {
    onChange(input.checked);
  });
  return input;
}

/**
 * A row that steps a value: a caret on each side of an icon and its value.
 *
 * The design's departure picker is two of these — a day and a time — rather
 * than a calendar or a text field, so this is the only shape either needs.
 *
 * @param onStep - Called with `-1` or `1`.
 * @returns The row, and the way to redraw its value after a step.
 */
export function stepperRow(
  iconId: string,
  value: () => string,
  previousLabel: string,
  nextLabel: string,
  onStep: (direction: -1 | 1) => void,
  canStep: (direction: -1 | 1) => boolean = () => true,
): { element: HTMLElement; refresh: () => void } {
  const element = el("div", RC.dropdownRow);

  const text = el("span", undefined, value());
  const middle = el("span", RC.dropdownStepperValue);
  middle.append(icon(iconId), text);

  const caret = (direction: -1 | 1, label: string) => {
    const button = el("button", RC.dropdownStep);
    button.type = "button";
    button.append(icon(direction === -1 ? "caret-left" : "caret-right"));
    button.setAttribute("aria-label", label);
    button.title = label;
    button.addEventListener("click", () => {
      onStep(direction);
    });
    return button;
  };

  const previous = caret(-1, previousLabel);
  const next = caret(1, nextLabel);
  element.append(previous, middle, next);

  return {
    element,
    refresh: () => {
      text.textContent = value();
      // the design mutes a caret whose step is not available, which for a
      // departure is any step back into the past
      previous.disabled = !canStep(-1);
      next.disabled = !canStep(1);
    },
  };
}

/**
 * A choice row: the label alone, with the radio kept for keyboard and
 * assistive-technology use but drawn by the row's selected state instead.
 */
export function choiceRow(label: string, radio: HTMLInputElement, selected: boolean): HTMLLabelElement {
  const row = menuRow(label);
  setDataFlag(row, "selected", selected);
  radio.classList.add(RC.srOnly);
  row.append(radio);
  return row;
}
