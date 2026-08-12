/**
 * Decodes an [encoded polyline][1] into `[lon, lat]` pairs.
 *
 * @param encoded - The encoded polyline.
 * @param precision - Number of decimal places the coordinates were encoded
 * with. The Routing API uses `6` (Valhalla's default), not the `5` of Google's
 * original algorithm.
 * @returns The decoded coordinates, in `[lon, lat]` order ready for GeoJSON.
 *
 * @remarks
 * The response always carries encoded geometry: the schema's
 * `response.encodePoints: false` is rejected by the live service, so this
 * decoder is not optional.
 *
 * [1]: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
      // A truncated string yields NaN here, which would spin forever; bail out
      // and keep whatever decoded cleanly.
    } while (byte >= 0x20 && index <= encoded.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= encoded.length);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) break;

    coordinates.push([lon / factor, lat / factor]);
  }

  return coordinates;
}
