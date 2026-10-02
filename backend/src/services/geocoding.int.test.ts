import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import type { Geocoder } from '../ports.ts';
import { createCachedGeocoder } from './geocoding.ts';

const pool = testPool();
const THEATRE = { label: 'Большой театр', location: { lat: 55.7603, lon: 37.6186 } };

let clock: Date;
let geocode: ReturnType<typeof vi.fn<Geocoder['geocode']>>;

function cached() {
  return createCachedGeocoder({ pool, geocoder: { geocode }, logger: { warn: vi.fn() }, now: () => clock });
}

beforeEach(async () => {
  await resetDatabase(pool);
  clock = new Date('2026-10-03T10:00:00Z');
  geocode = vi.fn<Geocoder['geocode']>();
});

afterAll(async () => {
  await closeTestPool();
});

describe('cached geocoding', () => {
  it('asks once per place and remembers misses for a week', async () => {
    geocode.mockResolvedValueOnce(THEATRE).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const geocoder = cached();
    expect(await geocoder.geocode('Большой театр')).toEqual(THEATRE);
    expect(await geocoder.geocode('большой  театр')).toEqual(THEATRE);
    expect(await geocoder.geocode('Нигде')).toBeNull();
    expect(await geocoder.geocode('Нигде')).toBeNull();
    expect(geocode).toHaveBeenCalledTimes(2);
    clock = new Date('2026-10-11T10:00:00Z');
    expect(await geocoder.geocode('Нигде')).toBeNull();
    expect(geocode).toHaveBeenCalledTimes(3);
  });

  it('pauses an unreachable geocoder for two minutes without remembering a miss', async () => {
    geocode.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(THEATRE);
    const geocoder = cached();
    expect(await geocoder.geocode('Большой театр')).toBeNull();
    expect(await geocoder.geocode('Большой театр')).toBeNull();
    expect(geocode).toHaveBeenCalledTimes(1);
    clock = new Date('2026-10-03T10:02:01Z');
    expect(await geocoder.geocode('Большой театр')).toEqual(THEATRE);
  });
});
