import { describe, expect, it } from "vitest";
import { routeToGpx } from "../../src/Routing/routing-export";
import { makeRoute } from "./fixtures";

describe("routeToGpx", () => {
  it("writes one <trkpt> per coordinate, lat and lon the right way round", () => {
    // [lng, lat] going in — the point of the test is that this does not come
    // back out as [lat, lon] by accident, which is the classic way to get this
    // wrong
    const route = makeRoute([
      [
        [8.5417, 47.3769],
        [12.8724, 50.2329],
      ],
    ]);

    const gpx = routeToGpx(route);

    expect(gpx).toContain('<trkpt lat="47.3769" lon="8.5417"/>');
    expect(gpx).toContain('<trkpt lat="50.2329" lon="12.8724"/>');
  });

  it("joins every leg into one track segment, in travel order, with no duplicated seam", () => {
    const route = makeRoute([
      [
        [8.54, 47.37],
        [9, 48],
      ],
      [
        [9, 48],
        [10, 49],
      ],
    ]);

    const gpx = routeToGpx(route);
    const points = [...gpx.matchAll(/<trkpt/g)];

    // the point shared by the two legs (9, 48) appears once, not twice
    expect(points).toHaveLength(3);
    expect(gpx.indexOf('lat="47.37"')).toBeLessThan(gpx.indexOf('lat="49"'));
  });

  it('names the track, defaulting to "Route"', () => {
    const route = makeRoute([[[8.54, 47.37]]]);

    expect(routeToGpx(route)).toContain("<name>Route</name>");
    expect(routeToGpx(route, "Zurich to Bern")).toContain("<name>Zurich to Bern</name>");
  });

  it("escapes a name that carries XML's special characters", () => {
    const route = makeRoute([[[8.54, 47.37]]]);

    expect(routeToGpx(route, "A & B <test>")).toContain("<name>A &amp; B &lt;test&gt;</name>");
  });

  it("is well-formed GPX 1.1", () => {
    const route = makeRoute([[[8.54, 47.37]]]);
    const gpx = routeToGpx(route);

    expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
  });
});
