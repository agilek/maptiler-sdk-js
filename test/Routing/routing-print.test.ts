import { afterEach, describe, expect, it } from "vitest";
import { flattenRouteSteps } from "../../src/Routing/routing-steps";
import { printRouteGuide } from "../../src/Routing/ui/routing-print";
import { resolveControlOptions } from "../../src/Routing/ui/routing-ui-defaults";
import { makeLeg, makeRoute, makeStep } from "./fixtures";

const { labels, formatters } = resolveControlOptions();

/**
 * The document the guide was built as, read off the iframe rather than out of
 * it: `srcdoc` is what the browser prints, and asserting on the markup keeps
 * the test away from a print dialog no test can answer.
 */
function guideMarkup(): string {
  const iframe = document.querySelector("iframe");
  expect(iframe).not.toBeNull();
  return iframe?.getAttribute("srcdoc") ?? "";
}

/** A route whose one leg carries the given steps. */
function routeWithSteps(steps: ReturnType<typeof makeStep>[]) {
  return makeRoute([[[8.54, 47.37]]], {
    legs: [
      makeLeg(
        [
          [8.54, 47.37],
          [12.87, 50.23],
        ],
        { steps },
      ),
    ],
  });
}

afterEach(() => {
  for (const iframe of document.querySelectorAll("iframe")) iframe.remove();
});

describe("printRouteGuide", () => {
  it("prints from a hidden iframe, so no popup blocker and no navigation away", () => {
    const route = routeWithSteps([makeStep()]);

    printRouteGuide(route, flattenRouteSteps(route), "km", labels, formatters);

    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    // out of the flow and out of sight: the visitor sees the print dialog, not
    // a frame appearing in the page
    expect(iframe?.style.visibility).toBe("hidden");
    expect(iframe?.style.position).toBe("fixed");
    expect(iframe?.style.width).toBe("0px");
  });

  it("lists every step, with its instruction and its distance", () => {
    const route = routeWithSteps([
      makeStep({ maneuver: { instruction: "Turn left onto Bahnhofstrasse", type: "leftTurn" }, length: 1.2 }),
      makeStep({ maneuver: { instruction: "Continue onto Seestrasse", type: "continue" }, length: 4 }),
    ]);

    printRouteGuide(route, flattenRouteSteps(route), "km", labels, formatters);
    const markup = guideMarkup();

    expect(markup).toContain("Turn left onto Bahnhofstrasse");
    expect(markup).toContain("Continue onto Seestrasse");
    // formatted through the same formatters the panel uses, not written raw
    expect(markup).toContain(formatters.distance(1.2, "km"));
    expect(markup).toContain(formatters.distance(4, "km"));
    expect([...markup.matchAll(/<li>/g)]).toHaveLength(2);
  });

  it("falls back to the street name, then to a plain instruction, when there is no maneuver", () => {
    const route = routeWithSteps([makeStep({ maneuver: undefined, streetName: "Seestrasse" }), makeStep({ maneuver: undefined, streetName: undefined })]);

    printRouteGuide(route, flattenRouteSteps(route), "km", labels, formatters);
    const markup = guideMarkup();

    expect(markup).toContain("Seestrasse");
    // a step with nothing to say still gets a row rather than an empty one
    expect(markup).toContain("Continue");
  });

  it("heads the guide with the route's own summary", () => {
    const route = routeWithSteps([makeStep()]);

    printRouteGuide(route, flattenRouteSteps(route), "mi", labels, formatters);
    const markup = guideMarkup();

    expect(markup).toContain(labels.routeOverview);
    expect(markup).toContain(formatters.duration(route.summary.totalTime));
    // the unit the caller asked for, not the one the panel happens to default to
    expect(markup).toContain(formatters.distance(route.summary.totalLength, "mi"));
  });

  it("escapes an instruction carrying HTML's special characters", () => {
    // instructions come from the service, and the guide is assembled as a
    // string: unescaped, this closes the list and runs as markup
    const route = routeWithSteps([makeStep({ maneuver: { instruction: '</li><script>alert("x")</script>', type: "continue" } })]);

    printRouteGuide(route, flattenRouteSteps(route), "km", labels, formatters);
    const markup = guideMarkup();

    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
    expect([...markup.matchAll(/<li>/g)]).toHaveLength(1);
  });

  it("escapes a consumer's own label the same way", () => {
    const route = routeWithSteps([makeStep()]);

    printRouteGuide(route, flattenRouteSteps(route), "km", { ...labels, routeOverview: "Route <b>overview</b> & guide" }, formatters);
    const markup = guideMarkup();

    expect(markup).not.toContain("<b>overview</b>");
    expect(markup).toContain("Route &lt;b&gt;overview&lt;/b&gt; &amp; guide");
  });

  it("declares the panel's language on the printed document", () => {
    const route = routeWithSteps([makeStep()]);

    printRouteGuide(route, flattenRouteSteps(route), "km", labels, formatters, "fr");

    expect(guideMarkup()).toContain('<html lang="fr">');
  });

  it("leaves the language out rather than writing an empty one", () => {
    const route = routeWithSteps([makeStep()]);

    printRouteGuide(route, flattenRouteSteps(route), "km", labels, formatters);

    expect(guideMarkup()).toContain("<html>");
  });

  it("escapes a language that would break out of the attribute", () => {
    const route = routeWithSteps([makeStep()]);

    printRouteGuide(route, flattenRouteSteps(route), "km", labels, formatters, 'fr" onload="x');

    const markup = guideMarkup();
    expect(markup).not.toContain('onload="x"');
    expect(markup).toContain("&quot;");
  });

  it("still produces a guide for a route with no steps", () => {
    const route = makeRoute([[[8.54, 47.37]]]);

    printRouteGuide(route, flattenRouteSteps(route), "km", labels, formatters);
    const markup = guideMarkup();

    // `detailLevel: "legs"` answers with no steps at all, which is a thin guide
    // rather than a broken one
    expect(markup).toContain("<ol></ol>");
    expect(markup).toContain(labels.routeOverview);
  });
});
