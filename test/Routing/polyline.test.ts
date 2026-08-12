import { describe, expect, it } from "vitest";
import { decodePolyline } from "../../src/Routing/polyline";
import { encodePolyline } from "./fixtures";

//#region decodePolyline

describe("decodePolyline", () => {
  it("decodes the reference polyline at precision 5", () => {
    // The canonical example from Google's polyline algorithm documentation,
    // whose expected output is published: (38.5, -120.2), (40.7, -120.95),
    // (43.252, -126.453).
    const decoded = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5);

    expect(decoded).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it("returns coordinates in [lon, lat] order, ready for GeoJSON", () => {
    const [first] = decodePolyline("_p~iF~ps|U", 5);

    expect(first[0]).toBeLessThan(0); // longitude
    expect(first[1]).toBeGreaterThan(0); // latitude
  });

  it("round-trips precision 6, which is what the Routing API uses", () => {
    const coordinates: [number, number][] = [
      [8.540192, 47.378177],
      [8.55, 47.4],
      [12.87, 50.232],
    ];

    const decoded = decodePolyline(encodePolyline(coordinates));

    expect(decoded).toHaveLength(3);
    decoded.forEach(([lon, lat], index) => {
      expect(lon).toBeCloseTo(coordinates[index][0], 6);
      expect(lat).toBeCloseTo(coordinates[index][1], 6);
    });
  });

  it("round-trips negative deltas", () => {
    const coordinates: [number, number][] = [
      [12.87, 50.23],
      [8.54, 47.37],
      [-3.7, 40.4],
    ];

    const decoded = decodePolyline(encodePolyline(coordinates));

    decoded.forEach(([lon, lat], index) => {
      expect(lon).toBeCloseTo(coordinates[index][0], 6);
      expect(lat).toBeCloseTo(coordinates[index][1], 6);
    });
  });

  it("decodes a single-point line", () => {
    expect(decodePolyline(encodePolyline([[8.540192, 47.378177]]))).toHaveLength(1);
  });

  it("returns an empty array for an empty string", () => {
    expect(decodePolyline("")).toEqual([]);
  });

  it("terminates on a truncated string instead of looping forever", () => {
    const truncated = encodePolyline([
      [8.540192, 47.378177],
      [8.55, 47.4],
    ]).slice(0, 4);

    // the assertion that matters is that this call returns at all
    expect(Array.isArray(decodePolyline(truncated))).toBe(true);
  });
});

//#endregion
