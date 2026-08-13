import { RC } from "./routing-ui-defaults";
import { el, icon, setBooleanAttribute } from "./routing-ui-dom";

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

  /** Drops the document listener. Called when the row is rebuilt. */
  destroy(): void {
    document.removeEventListener("pointerdown", this.onDocumentPointerDown, true);
  }

  private setOpen(open: boolean): void {
    if (this.opened === open) return;

    this.opened = open;
    this.menu.hidden = !open;
    setBooleanAttribute(this.toggle, "aria-expanded", open);

    if (open) document.addEventListener("pointerdown", this.onDocumentPointerDown, true);
    else document.removeEventListener("pointerdown", this.onDocumentPointerDown, true);
  }
}

/** A labelled row inside a dropdown menu, holding one control. */
export function menuRow(label: string, control: HTMLElement): HTMLLabelElement {
  const row = el("label", RC.dropdownRow);
  row.append(el("span", undefined, label), control);
  return row;
}

/**
 * A number input for a dropdown menu.
 *
 * @param value - Current value, or `undefined` when the option is unset — an
 * empty field means "let the service decide", which is not the same as zero.
 */
export function numberField(value: number | undefined, min: number, step: number, onChange: (value: number | undefined) => void): HTMLInputElement {
  const input = el("input", RC.dropdownNumber);
  input.type = "number";
  input.min = min.toString();
  input.step = step.toString();
  input.value = value === undefined ? "" : value.toString();

  input.addEventListener("change", () => {
    onChange(input.value === "" ? undefined : Number(input.value));
  });

  return input;
}
