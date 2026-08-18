import { expect, test, type Page, type Route } from "@playwright/test";
import path from "path";
import loadFixtureAndGetMapHandle from "./helpers/loadFixtureAndGetMapHandle";

const DIRECTIONS_URL = "https://api.maptiler.com/routing/v1/directions*";
const GEOCODING_URL = "https://api.maptiler.com/geocoding/*";

/** Fulfils every directions request from the recorded fixture used by routing.test.ts. */
async function mockDirections(page: Page): Promise<void> {
  await page.route(DIRECTIONS_URL, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      path: path.resolve(import.meta.dirname, "./mocks/routing-directions.json"),
    });
  });
}

/**
 * Fulfils every geocoding request with the same two-result fixture, whatever
 * the query — this stands in for both a typed search and the reverse lookup
 * the panel runs on mount to name a waypoint that arrived as bare coordinates.
 */
async function mockGeocoding(page: Page): Promise<{ queries: string[] }> {
  const queries: string[] = [];

  await page.route(GEOCODING_URL, async (route: Route) => {
    const [, query = ""] = /\/geocoding\/([^/]+)\.json/.exec(new URL(route.request().url()).pathname) ?? [];
    queries.push(decodeURIComponent(query));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      path: path.resolve(import.meta.dirname, "./mocks/geocoding-zurich.json"),
    });
  });

  return { queries };
}

/**
 * Every test needs both mocks: the panel reverse-geocodes its initial
 * coordinate-only waypoints on mount, so a test that only mocks directions
 * still sends a real, unmocked geocoding request.
 */
async function setup(page: Page, queryParams?: Record<string, string>): Promise<{ queries: string[] }> {
  await mockDirections(page);
  const geocoding = await mockGeocoding(page);
  await loadFixtureAndGetMapHandle({ fixture: "routingControl", page, mockStyle: "maptiler-style-routing.json", queryParams });
  return geocoding;
}

//#region Opening and closing

test("opens from the launcher, and the close button closes it again", async ({ page }) => {
  await setup(page);

  const panel = page.locator(".maptiler-routing-panel");
  const launcher = page.getByRole("button", { name: "Close the directions panel" });

  // `open: true` is the default, so the panel starts visible with no click
  await expect(panel).toBeVisible();
  await expect(launcher).toBeVisible();

  await launcher.click();
  await expect(panel).toBeHidden();

  const reopen = page.getByRole("button", { name: "Directions" });
  await reopen.click();
  await expect(panel).toBeVisible();

  const events = await page.evaluate(() => window.__panelEvents.map((event) => event.type));
  expect(events).toEqual(["routinguiclose", "routinguiopen"]);
});

//#endregion

//#region Place search

test("lists geocoded suggestions as the visitor types, and picking one sets the waypoint", async ({ page }) => {
  const { queries } = await setup(page);

  const fromInput = page.locator(".maptiler-routing-waypoint-input").first();
  await fromInput.click();
  await fromInput.fill("zurich");

  const suggestions = page.locator(".maptiler-routing-suggestion");
  await expect(suggestions.first()).toBeVisible();
  await expect(suggestions).toHaveCount(2);

  await expect.poll(() => queries).toContain("zurich");

  await suggestions.first().click();

  await expect(fromInput).toHaveValue("Zurich, Switzerland");

  const waypoint = await page.evaluate(() => window.__map.getRouting()?.getWaypoints()[0]);
  expect(waypoint?.lngLat).toEqual([8.5417, 47.3769]);
});

//#endregion

//#region Reordering

test("moves a stop with the keyboard, mirroring what a drag does", async ({ page }) => {
  await setup(page);

  await page.evaluate(() => {
    window.__map.getRouting()?.addWaypoint([11.582, 48.1351], 1); // Munich, in the middle
  });

  const before = await page.evaluate(() =>
    window.__map
      .getRouting()
      ?.getWaypoints()
      .map((waypoint) => waypoint.lngLat),
  );
  expect(before).toHaveLength(3);

  const handles = page.locator(".maptiler-routing-waypoint-handle");
  await expect(handles).toHaveCount(3);

  // Alt+ArrowDown on the first handle is the keyboard path to the same
  // `moveWaypoint` a pointer drag calls — reliable in CI, where a synthetic
  // pointer-capture drag is not.
  await handles.first().focus();
  await handles.first().press("Alt+ArrowDown");

  const after = await page.evaluate(() =>
    window.__map
      .getRouting()
      ?.getWaypoints()
      .map((waypoint) => waypoint.lngLat),
  );
  expect(after).toEqual([before?.[1], before?.[0], before?.[2]]);
});

//#endregion

//#region Position

for (const position of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
  test(`stays inside the viewport from the "${position}" corner`, async ({ page }) => {
    await setup(page, { position });

    const panel = page.locator(".maptiler-routing-panel");
    await expect(panel).toBeVisible();

    const box = await panel.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();

    if (box && viewport) {
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
  });
}

//#endregion

//#region Turn-by-turn

test("opens turn-by-turn from a route card, and the back button returns to the list", async ({ page }) => {
  await setup(page);

  const routeCards = page.locator(".maptiler-routing-route-card");
  await expect(routeCards.first()).toBeVisible();

  await page.getByRole("button", { name: "Show the turn-by-turn directions" }).first().click();

  const steps = page.locator(".maptiler-routing-step");
  await expect(steps.first()).toBeVisible();
  await expect(routeCards.first()).toBeHidden();

  await page.locator(".maptiler-routing-detail-back").click();

  await expect(routeCards.first()).toBeVisible();
  await expect(steps.first()).toBeHidden();

  const events = await page.evaluate(() => window.__panelEvents.map((event) => event.type));
  expect(events).toEqual(["routinguiviewchange", "routinguiviewchange"]);
});

//#endregion

//#region Download menu

test("saves the route as GPX", async ({ page }) => {
  // stubbed rather than let it run: a real click would start a browser
  // download, which the test cannot observe — the link's own attributes,
  // captured the instant before, are proof enough of what downloadText built.
  // Registered before the fixture navigates, which is what makes it apply.
  await page.addInitScript(() => {
    window.__downloadedLinks = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with .call(this) below, so the unbound reference is never invoked on its own
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.download) window.__downloadedLinks.push({ filename: this.download, href: this.href });
      else originalClick.call(this);
    };
  });

  await setup(page);

  await page.getByRole("button", { name: "Show the turn-by-turn directions" }).first().click();
  await page.getByRole("button", { name: "Download this route" }).click();
  await page.getByText("Download route (GPX)").click();

  const links = await page.evaluate(() => window.__downloadedLinks);
  expect(links).toHaveLength(1);
  expect(links[0].filename).toBe("route.gpx");
  expect(links[0].href).toMatch(/^blob:/);

  const events = await page.evaluate(() => window.__panelEvents.filter((event) => event.type === "routinguidownload"));
  expect(events).toEqual([{ type: "routinguidownload", format: "gpx" }]);
});

test("prints a turn-by-turn guide", async ({ page }) => {
  // the print dialog is native browser UI, out of a test's reach — and a real
  // `print()` fires `afterprint` almost immediately in a headless browser,
  // which would tear the iframe down before this can inspect it. Stubbed
  // instead, before the fixture navigates: a call recorded here is proof the
  // iframe was built and handed to `print()`, which is what this owns.
  await page.addInitScript(() => {
    const top = window.top ?? window;
    top.__printCalls = 0;
    window.print = () => {
      top.__printCalls++;
    };
  });

  await setup(page);

  await page.getByRole("button", { name: "Show the turn-by-turn directions" }).first().click();
  await page.getByRole("button", { name: "Download this route" }).click();
  await page.getByText("Download guide (PDF)").click();

  // the fixture page has no iframe of its own, so this is unambiguously the
  // one printRouteGuide built. Attached rather than visible: the iframe is
  // deliberately 0×0 and visibility:hidden — it exists only for `print()`,
  // never to be seen.
  const iframe = page.locator("iframe");
  await expect(iframe).toHaveCount(1);
  await expect(iframe.contentFrame().getByRole("heading", { name: "Route overview" })).toBeAttached();
  await expect.poll(() => page.evaluate(() => window.__printCalls)).toBe(1);

  const events = await page.evaluate(() => window.__panelEvents.filter((event) => event.type === "routinguidownload"));
  expect(events).toEqual([{ type: "routinguidownload", format: "pdf" }]);
});

test("hides the download menu when turnByTurn.download is off", async ({ page }) => {
  await setup(page, { download: "off" });

  await page.getByRole("button", { name: "Show the turn-by-turn directions" }).first().click();

  await expect(page.getByRole("button", { name: "Download this route" })).toHaveCount(0);
});

//#endregion

//#region Visual regression

test("panel screenshot", async ({ page }) => {
  await setup(page);

  const routeCards = page.locator(".maptiler-routing-route-card");
  await expect(routeCards.first()).toBeVisible();
  await page.waitForTimeout(500);

  await expect(page).toHaveScreenshot("routing-control-panel.png");
});

//#endregion
