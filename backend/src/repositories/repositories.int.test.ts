import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import type { Venue } from '../domain/models.ts';
import * as geocodeCache from './geocode-cache.ts';
import * as places from './places.ts';
import * as venues from './venues.ts';
import * as weights from './weights.ts';

const pool = testPool();

const TVERSKAYA = { lat: 55.764895, lon: 37.606313 };

const venue = (
  id: number,
  name: string,
  tags: string[],
  lat: number,
  lon: number,
  avgBill = 1500,
): Venue => ({
  id,
  name,
  description: 'Бар',
  address: '',
  tags,
  avgBill,
  mapsUrl: `https://yandex.ru/maps/?text=${id}`,
  location: { lat, lon },
});

const SEARCH: venues.VenueSearch = {
  center: TVERSKAYA,
  radiusM: 800,
  districtId: null,
  bufferM: 0,
  category: null,
  cuisines: [],
  budgetMax: null,
  limit: 50,
};

const SQUARE = [
  [
    [
      [37.6, 55.76],
      [37.62, 55.76],
      [37.62, 55.77],
      [37.6, 55.77],
      [37.6, 55.76],
    ],
  ],
];

beforeEach(async () => {
  await resetDatabase(pool);
  await venues.replaceAll(pool, [
    venue(1, 'Рядом', ['бар', 'суши'], 55.7655, 37.6065),
    venue(2, 'Через квартал', ['бар'], 55.7685, 37.6065),
    venue(3, 'Далеко', ['бар'], 55.75, 37.65),
    venue(4, 'Кофейня', ['кафе'], 55.7652, 37.607, 800),
  ]);
  await places.replaceAll(pool, [
    { id: 1, kind: 'metro', name: 'Тверская', location: TVERSKAYA, area: null },
    { id: 2, kind: 'district', name: 'Тверской район', location: { lat: 55.765, lon: 37.61 }, area: SQUARE },
  ]);
});

afterAll(async () => {
  await closeTestPool();
});

describe('venue search', () => {
  it('finds venues within the radius, nearest first, with the distance', async () => {
    const found = await venues.search(pool, SEARCH);
    expect(found.map((entry) => entry.venue.id)).toEqual([4, 1, 2]);
    const near = found.find((entry) => entry.venue.id === 1);
    expect(near?.distanceM).toBeGreaterThan(60);
    expect(near?.distanceM).toBeLessThan(80);
    expect(near?.venue).toEqual(venue(1, 'Рядом', ['бар', 'суши'], 55.7655, 37.6065));
  });

  it('filters by category, cuisine and budget', async () => {
    expect((await venues.search(pool, { ...SEARCH, category: 'бар' })).map((e) => e.venue.id)).toEqual([
      1, 2,
    ]);
    expect((await venues.search(pool, { ...SEARCH, cuisines: ['суши'] })).map((e) => e.venue.id)).toEqual([
      1,
    ]);
    expect((await venues.search(pool, { ...SEARCH, budgetMax: 1000 })).map((e) => e.venue.id)).toEqual([4]);
  });

  it('searches inside a district and around it', async () => {
    const district = { ...SEARCH, radiusM: null, districtId: 2, center: { lat: 55.765, lon: 37.61 } };
    expect((await venues.search(pool, district)).map((e) => e.venue.id).sort()).toEqual([1, 2, 4]);
    const wider = await venues.search(pool, { ...district, bufferM: 4000 });
    expect(wider.map((e) => e.venue.id).sort()).toEqual([1, 2, 3, 4]);
  });

  it('searches the whole city without a center', async () => {
    const found = await venues.search(pool, { ...SEARCH, center: null, radiusM: null });
    expect(found).toHaveLength(4);
    expect(found.every((entry) => entry.distanceM === null)).toBe(true);
  });

  it('reads the tags of one venue', async () => {
    expect(await venues.findTags(pool, 1)).toEqual(['бар', 'суши']);
    expect(await venues.findTags(pool, 99)).toBeNull();
  });
});

describe('places', () => {
  it('lists places with their points', async () => {
    expect(await places.listAll(pool)).toEqual([
      { id: 1, kind: 'metro', name: 'Тверская', location: TVERSKAYA },
      { id: 2, kind: 'district', name: 'Тверской район', location: { lat: 55.765, lon: 37.61 } },
    ]);
  });
});

describe('taste weights', () => {
  it('adds up likes per tag and keeps them within the limit', async () => {
    await weights.add(pool, 7, ['бар', 'бар', 'суши'], 0.2);
    await weights.add(pool, 7, ['бар'], 0.2);
    expect(Object.fromEntries(await weights.forUser(pool, 7))).toEqual({ бар: 0.4, суши: 0.2 });
    for (let index = 0; index < 20; index += 1) await weights.add(pool, 7, ['суши'], -0.5);
    expect((await weights.forUser(pool, 7)).get('суши')).toBe(-2);
    expect((await weights.forUser(pool, 8)).size).toBe(0);
  });
});

describe('geocode cache', () => {
  it('remembers found and missing places', async () => {
    const now = new Date('2026-10-03T10:00:00Z');
    await geocodeCache.save(pool, 'большой театр', { label: 'Большой театр', location: TVERSKAYA }, now);
    await geocodeCache.save(pool, 'нигде', null, now);
    expect(await geocodeCache.find(pool, 'большой театр')).toEqual({
      label: 'Большой театр',
      location: TVERSKAYA,
      createdAt: now,
    });
    expect(await geocodeCache.find(pool, 'нигде')).toEqual({ label: null, location: null, createdAt: now });
    expect(await geocodeCache.find(pool, 'другое')).toBeNull();
  });
});
