import type { GeoPoint } from './models.ts';

const EARTH_RADIUS_M = 6_371_000;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceMeters(from: GeoPoint, to: GeoPoint): number {
  const dLat = radians(to.lat - from.lat);
  const dLon = radians(to.lon - from.lon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const MOSCOW_BOUNDS = { south: 55.49, west: 37.32, north: 55.96, east: 37.97 };

export function insideMoscow({ lat, lon }: GeoPoint): boolean {
  return (
    lat >= MOSCOW_BOUNDS.south &&
    lat <= MOSCOW_BOUNDS.north &&
    lon >= MOSCOW_BOUNDS.west &&
    lon <= MOSCOW_BOUNDS.east
  );
}
