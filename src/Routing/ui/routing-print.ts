import type { FlatRouteStep } from "../routing-steps";
import type { Route, RoutingUnits } from "../types";
import type { RoutingControlFormatters, RoutingControlLabels } from "./routing-ui-types";

/**
 * Escapes the characters HTML gives special meaning.
 *
 * Quotes included, so the same function is safe for an attribute value as well
 * as for text between tags — the guide is assembled as a string, and one
 * function that covers both is one fewer thing to get wrong at a call site.
 */
function escapeHtml(text: string): string {
  return text.replace(/[<>&"']/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/**
 * Opens the browser's print dialog on a turn-by-turn guide for one route —
 * the "download guide (PDF)" option, which saves as PDF through the dialog
 * itself rather than through a generated file.
 *
 * @remarks
 * Built in a hidden iframe rather than a new window or tab: a popup blocker
 * cannot catch it, and the host page is never navigated away from or replaced.
 * The iframe is removed once printing is done — `afterprint` fires whether the
 * visitor printed or cancelled, which is what makes it the right moment — with
 * a generous timeout as a backstop for browsers that do not fire it inside a
 * frame.
 */
export function printRouteGuide(
  route: Route,
  steps: readonly FlatRouteStep[],
  units: RoutingUnits,
  labels: Required<RoutingControlLabels>,
  formatters: Required<RoutingControlFormatters>,
  language?: string,
): void {
  const rows = steps
    .map((entry) => {
      const instruction = entry.step.maneuver?.instruction ?? entry.step.streetName ?? "Continue";
      return `<li><span>${escapeHtml(instruction)}</span><span>${escapeHtml(formatters.distance(entry.step.length, units))}</span></li>`;
    })
    .join("");

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;border:0;visibility:hidden;";

  // Safari does not fire `afterprint` reliably inside an iframe; a generous
  // timeout is the backstop that keeps this from ever being left behind.
  const backstop = setTimeout(() => {
    iframe.remove();
  }, 60_000);

  // whichever arrives first takes the other with it
  const cleanup = () => {
    clearTimeout(backstop);
    iframe.remove();
  };

  iframe.addEventListener("load", () => {
    iframe.contentWindow?.addEventListener("afterprint", cleanup);
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
  });

  // `srcdoc` rather than `document.write`: it parses like a normal navigation,
  // deprecation-free, and fires `load` exactly once the content is ready.
  // the panel's own language, so a screen reader or a PDF reader treats the
  // instructions as the language they actually came back in
  iframe.srcdoc = `<!DOCTYPE html>
<html${language ? ` lang="${escapeHtml(language)}"` : ""}>
<head>
<meta charset="utf-8">
<title>${escapeHtml(labels.routeOverview)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; padding: 32px; color: #1a1a2e; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.summary { color: #6b7c93; margin: 0 0 24px; font-size: 14px; }
  ol { list-style: decimal; margin: 0; padding-left: 20px; }
  li { display: flex; justify-content: space-between; gap: 24px; padding: 8px 0; border-bottom: 1px solid #e1eaff; }
  li span:last-child { color: #6b7c93; white-space: nowrap; }
</style>
</head>
<body>
  <h1>${escapeHtml(labels.routeOverview)}</h1>
  <p class="summary">${escapeHtml(formatters.duration(route.summary.totalTime))} · ${escapeHtml(formatters.distance(route.summary.totalLength, units))}</p>
  <ol>${rows}</ol>
</body>
</html>`;
  document.body.append(iframe);
}
