import { expect, test, type Page, type Route } from "@playwright/test";
import path from "path";
import loadFixtureAndGetMapHandle from "./helpers/loadFixtureAndGetMapHandle";

const DIRECTIONS_URL = "https://api.maptiler.com/routing/v1/directions*";

const SOURCE_ID = "maptiler-routing-routes";
const LINE_LAYER_ID = "maptiler-routing-route-line";
const CASING_LAYER_ID = "maptiler-routing-route-casing";
const HITBOX_LAYER_ID = "maptiler-routing-route-hitbox";

/**
 * Fulfils every directions request from the recorded fixture, and records the
 * bodies so the test can assert on what the SDK actually asked for.
 */
async function mockDirections(page: Page): Promise<{ bodies: unknown[] }> {
  const bodies: unknown[] = [];

  await page.route(DIRECTIONS_URL, async (route: Route) => {
    bodies.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      path: path.resolve(import.meta.dirname, "./mocks/routing-directions.json"),
    });
  });

  return { bodies };
}

/** State of the drawn route, read straight off the map instance. */
async function readRouteState(page: Page) {
  return page.evaluate(
    async ({ sourceId, lineLayerId, casingLayerId, hitboxLayerId }) => {
      const map = window.__map;
      const source = map.getSource(sourceId) as { getData?: () => Promise<{ features?: { properties: { index: number; selected: boolean } }[] }> } | undefined;
      const data = source?.getData ? await source.getData() : undefined;
      const features = data?.features ?? [];
      const order = map.getLayersOrder();
      const firstSymbolIndex = order.findIndex((id) => map.getLayer(id)?.type === "symbol");

      return {
        hasSource: Boolean(source),
        hasLine: Boolean(map.getLayer(lineLayerId)),
        hasCasing: Boolean(map.getLayer(casingLayerId)),
        hasHitbox: Boolean(map.getLayer(hitboxLayerId)),
        featureCount: features.length,
        selectedIndices: features.filter((feature) => feature.properties.selected).map((feature) => feature.properties.index),
        lineIndex: order.indexOf(lineLayerId),
        firstSymbolIndex,
        // a route-label badge is a Marker too — its element carries both
        // classes at once — so it must be told apart from a waypoint marker
        // rather than counted as one
        waypointMarkerCount: document.querySelectorAll(".maplibregl-marker:not(.maptiler-routing-route-label)").length,
        routeLabelMarkerCount: document.querySelectorAll(".maplibregl-marker.maptiler-routing-route-label").length,
      };
    },
    { sourceId: SOURCE_ID, lineLayerId: LINE_LAYER_ID, casingLayerId: CASING_LAYER_ID, hitboxLayerId: HITBOX_LAYER_ID },
  );
}

test("draws the routes it was given, under the labels", async ({ page }) => {
  await mockDirections(page);
  await loadFixtureAndGetMapHandle({ fixture: "routing", page, mockStyle: "maptiler-style-routing.json" });

  await expect.poll(async () => (await readRouteState(page)).featureCount).toBe(3);

  const state = await readRouteState(page);

  expect(state.hasSource).toBe(true);
  expect(state.hasCasing).toBe(true);
  expect(state.hasLine).toBe(true);
  expect(state.hasHitbox).toBe(true);

  // exactly one route is selected, and it is the best one
  expect(state.selectedIndices).toEqual([0]);

  // the route is inserted before the first symbol layer, so labels stay on top
  expect(state.firstSymbolIndex).toBeGreaterThan(-1);
  expect(state.lineIndex).toBeLessThan(state.firstSymbolIndex);

  // one marker per located waypoint
  expect(state.waypointMarkerCount).toBe(2);

  // one travel-time badge per route, shown by default
  expect(state.routeLabelMarkerCount).toBe(3);
});

test("asks for exactly what the session was configured with", async ({ page }) => {
  const { bodies } = await mockDirections(page);
  await loadFixtureAndGetMapHandle({ fixture: "routing", page, mockStyle: "maptiler-style-routing.json" });

  await expect.poll(() => bodies.length).toBeGreaterThan(0);

  const body = bodies[0] as {
    profile: string;
    locations: { lon: number; lat: number }[];
    response: { units: string; alternates: number; additionalData: { detailLevel: string }; encodePoints?: unknown };
  };

  expect(body.profile).toBe("car");
  expect(body.locations).toHaveLength(2);
  expect(body.response.units).toBe("km");
  expect(body.response.alternates).toBe(2);
  expect(body.response.additionalData.detailLevel).toBe("instructions");

  // the live service rejects `encodePoints`, so it must never be sent
  expect(body.response).not.toHaveProperty("encodePoints");
});

test("puts the route back after a style change", async ({ page }) => {
  await mockDirections(page);
  await loadFixtureAndGetMapHandle({ fixture: "routing", page, mockStyle: "maptiler-style-routing.json" });

  await expect.poll(async () => (await readRouteState(page)).featureCount).toBe(3);

  await page.evaluate(() => {
    window.__map.setStyle("streets-v2-dark");
  });

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.__map.once("idle", () => resolve());
      }),
  );

  const state = await readRouteState(page);

  // MapLibre drops every layer on a style swap; the renderer must re-add them
  // with the same data and the same selection
  expect(state.hasSource).toBe(true);
  expect(state.hasLine).toBe(true);
  expect(state.featureCount).toBe(3);
  expect(state.selectedIndices).toEqual([0]);
  expect(state.lineIndex).toBeLessThan(state.firstSymbolIndex);
});

test("selects an alternate without refetching", async ({ page }) => {
  const { bodies } = await mockDirections(page);
  await loadFixtureAndGetMapHandle({ fixture: "routing", page, mockStyle: "maptiler-style-routing.json" });

  await expect.poll(async () => (await readRouteState(page)).featureCount).toBe(3);
  const requestsBefore = bodies.length;

  await page.evaluate(() => {
    window.__map.getRouting()?.selectRoute(1);
  });

  const state = await readRouteState(page);
  expect(state.selectedIndices).toEqual([1]);

  const events = await page.evaluate(() => window.__routingEvents);
  expect(events.filter((event) => event.type === "routingselect")).toHaveLength(1);

  // choosing between routes already in hand must not cost a request
  expect(bodies.length).toBe(requestsBefore);
});

test("coalesces a burst of waypoint edits into one request", async ({ page }) => {
  const { bodies } = await mockDirections(page);
  await loadFixtureAndGetMapHandle({ fixture: "routing", page, mockStyle: "maptiler-style-routing.json" });

  await expect.poll(() => bodies.length).toBe(1);

  await page.evaluate(() => {
    const routing = window.__map.getRouting();
    if (!routing) return;
    // three changes inside the debounce window
    routing.setUnits("mi");
    routing.setAlternates(1);
    routing.addWaypoint([11.582, 48.1351], 1);
  });

  await page.waitForTimeout(1500);

  expect(bodies.length).toBe(2);

  const events = await page.evaluate(() => window.__routingEvents);
  expect(events.filter((event) => event.type === "routingerror")).toHaveLength(0);
});

test("routes screenshot", async ({ page }) => {
  await mockDirections(page);
  await loadFixtureAndGetMapHandle({ fixture: "routing", page, mockStyle: "maptiler-style-routing.json" });

  await expect.poll(async () => (await readRouteState(page)).featureCount).toBe(3);
  await page.waitForTimeout(500);

  await expect(page).toHaveScreenshot("routing-routes.png");
});
