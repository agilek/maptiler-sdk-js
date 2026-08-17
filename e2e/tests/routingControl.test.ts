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

//#region Visual regression

test("panel screenshot", async ({ page }) => {
  await setup(page);

  const routeCards = page.locator(".maptiler-routing-route-card");
  await expect(routeCards.first()).toBeVisible();
  await page.waitForTimeout(500);

  await expect(page).toHaveScreenshot("routing-control-panel.png");
});

//#endregion
