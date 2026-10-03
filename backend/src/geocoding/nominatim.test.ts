import { describe, expect, it, vi } from 'vitest';
import { createNominatim } from './nominatim.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Nominatim geocoder', () => {
  it('searches inside Moscow and names the place', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json([
        {
          lat: '55.7604',
          lon: '37.6186',
          name: 'Большой театр',
          display_name: 'Большой театр, Театральная площадь',
        },
      ]),
    );
    const geocoder = createNominatim({ userAgent: 'spotwhere-test', fetch });

    expect(await geocoder.geocode('Большого театра')).toEqual({
      label: 'Большой театр',
      location: { lat: 55.7604, lon: 37.6186 },
    });
    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.searchParams.get('q')).toBe('Большого театра, Москва');
    expect(url.searchParams.get('bounded')).toBe('1');
    expect(url.searchParams.get('viewbox')).toBe('37.32,55.96,37.97,55.49');
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('User-Agent')).toBe('spotwhere-test');
  });

  it('finds nothing outside Moscow or without results and fails on errors', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json([{ lat: '59.93', lon: '30.31', display_name: 'Санкт-Петербург' }]))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ error: 'busy' }, 429));
    const geocoder = createNominatim({ userAgent: 'test', fetch, sleep: () => Promise.resolve() });
    expect(await geocoder.geocode('Невский')).toBeNull();
    expect(await geocoder.geocode('нигде')).toBeNull();
    await expect(geocoder.geocode('ещё')).rejects.toThrow('Nominatim answered 429');
  });

  it('waits at least the interval between requests', async () => {
    let clock = 0;
    const waits: number[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => Promise.resolve(json([])));
    const geocoder = createNominatim({
      userAgent: 'test',
      fetch,
      now: () => clock,
      sleep: (ms) => {
        waits.push(ms);
        clock += ms;
        return Promise.resolve();
      },
      minIntervalMs: 1000,
    });
    await Promise.all([geocoder.geocode('а'), geocoder.geocode('б'), geocoder.geocode('в')]);
    expect(waits).toEqual([1000, 1000]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
