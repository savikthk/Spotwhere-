import { distanceMeters } from '../src/domain/geo.ts';
import type { GeoPoint } from '../src/domain/models.ts';
import { nameKey } from '../src/domain/text.ts';

export interface OsmElement {
  type: string;
  lat?: number;
  lon?: number;
  center?: GeoPoint;
  tags?: Record<string, string>;
}

export interface OsmMember {
  type: string;
  role: string;
  geometry?: GeoPoint[];
}

export interface OsmRelation {
  type: 'relation';
  tags?: Record<string, string>;
  members?: OsmMember[];
}

export type Position = [number, number];
export type Ring = Position[];
export type MultiPolygon = Ring[][];

export interface NamedPlace {
  kind: 'metro' | 'landmark';
  name: string;
  aliases: string[];
  lat: number;
  lon: number;
}

export interface DistrictPlace {
  kind: 'district';
  name: string;
  lat: number;
  lon: number;
  area: MultiPolygon;
}

const SAME_STATION_M = 1500;

const ALIAS_TAGS = ['alt_name', 'short_name'];

function aliasesOf(tags: Record<string, string>, name: string): string[] {
  return ALIAS_TAGS.flatMap((key) => (tags[key] ?? '').split(';'))
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0 && nameKey(alias) !== nameKey(name));
}

export function mergeNamed(elements: readonly OsmElement[], kind: NamedPlace['kind']): NamedPlace[] {
  const groups: { name: string; aliases: Set<string>; points: GeoPoint[] }[] = [];
  for (const element of elements) {
    const name = element.tags?.name?.trim();
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (!name || lat === undefined || lon === undefined) continue;
    const point = { lat, lon };
    const group = groups.find(
      (candidate) =>
        nameKey(candidate.name) === nameKey(name) &&
        candidate.points.some((other) => distanceMeters(other, point) <= SAME_STATION_M),
    );
    const aliases = aliasesOf(element.tags ?? {}, name);
    if (group) {
      group.points.push(point);
      aliases.forEach((alias) => group.aliases.add(alias));
    } else {
      groups.push({ name, aliases: new Set(aliases), points: [point] });
    }
  }
  return groups
    .map(({ name, aliases, points }) => ({
      kind,
      name,
      aliases: [...aliases].sort(),
      lat: round(points.reduce((sum, point) => sum + point.lat, 0) / points.length),
      lon: round(points.reduce((sum, point) => sum + point.lon, 0) / points.length),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function same(left: Position | undefined, right: Position | undefined): boolean {
  return left !== undefined && right !== undefined && left[0] === right[0] && left[1] === right[1];
}

export function assembleRings(ways: readonly Position[][]): Ring[] {
  const pending = ways.filter((way) => way.length >= 2).map((way) => [...way]);
  const rings: Ring[] = [];
  while (pending.length > 0) {
    const ring = pending.shift() ?? [];
    let extended = true;
    while (!same(ring[0], ring.at(-1)) && extended) {
      extended = false;
      for (let index = 0; index < pending.length; index += 1) {
        const way = pending[index] ?? [];
        if (same(way[0], ring.at(-1))) ring.push(...way.slice(1));
        else if (same(way.at(-1), ring.at(-1))) ring.push(...[...way].reverse().slice(1));
        else continue;
        pending.splice(index, 1);
        extended = true;
        break;
      }
    }
    if (same(ring[0], ring.at(-1)) && ring.length >= 4) rings.push(ring);
  }
  return rings;
}

export function containsPoint(ring: Ring, [x, y]: Position): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index] ?? [0, 0];
    const [xj, yj] = ring[previous] ?? [0, 0];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function perpendicular([x, y]: Position, [x1, y1]: Position, [x2, y2]: Position): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(x - x1, y - y1);
  return Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / length;
}

function simplifyLine(points: Position[], tolerance: number): Position[] {
  if (points.length <= 2) return points;
  const first = points[0] as Position;
  const last = points.at(-1) as Position;
  let farthest = 0;
  let index = 0;
  for (let cursor = 1; cursor < points.length - 1; cursor += 1) {
    const distance = perpendicular(points[cursor] as Position, first, last);
    if (distance > farthest) {
      farthest = distance;
      index = cursor;
    }
  }
  if (farthest <= tolerance) return [first, last];
  return [
    ...simplifyLine(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplifyLine(points.slice(index), tolerance),
  ];
}

export function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 5) return ring;
  const middle = Math.floor(ring.length / 2);
  const simplified = [
    ...simplifyLine(ring.slice(0, middle + 1), tolerance).slice(0, -1),
    ...simplifyLine(ring.slice(middle), tolerance),
  ];
  return simplified.length >= 4 ? simplified.map(([x, y]) => [round(x), round(y)]) : ring;
}

const DISTRICT_TOLERANCE_DEG = 0.00015;

export function districtArea(relation: OsmRelation): MultiPolygon {
  const ways = (role: string) =>
    (relation.members ?? [])
      .filter((member) => member.type === 'way' && member.role === role && member.geometry)
      .map((member) => (member.geometry ?? []).map(({ lat, lon }): Position => [lon, lat]));
  const outers = assembleRings(ways('outer')).map((ring) => simplifyRing(ring, DISTRICT_TOLERANCE_DEG));
  const inners = assembleRings(ways('inner')).map((ring) => simplifyRing(ring, DISTRICT_TOLERANCE_DEG));
  return outers.map((outer) => [
    outer,
    ...inners.filter((inner) => inner[0] !== undefined && containsPoint(outer, inner[0])),
  ]);
}

export function areaCenter(area: MultiPolygon): GeoPoint {
  const points = area.flatMap((polygon) => polygon[0] ?? []);
  const lon = points.reduce((sum, [x]) => sum + x, 0) / Math.max(points.length, 1);
  const lat = points.reduce((sum, [, y]) => sum + y, 0) / Math.max(points.length, 1);
  return { lat: round(lat), lon: round(lon) };
}
