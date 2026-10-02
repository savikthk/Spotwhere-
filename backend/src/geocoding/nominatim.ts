import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { insideMoscow, MOSCOW_BOUNDS } from '../domain/geo.ts';
import type { Geocoder } from '../ports.ts';

const SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const VIEWBOX = [MOSCOW_BOUNDS.west, MOSCOW_BOUNDS.north, MOSCOW_BOUNDS.east, MOSCOW_BOUNDS.south].join(',');

const Results = z.array(
  z.object({
    lat: z.coerce.number(),
    lon: z.coerce.number(),
    name: z.string().optional(),
    display_name: z.string(),
  }),
);

export interface NominatimOptions {
  userAgent: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  minIntervalMs?: number;
  timeoutMs?: number;
}

export function createNominatim(options: NominatimOptions): Geocoder {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const minIntervalMs = options.minIntervalMs ?? 1_100;
  let queue: Promise<unknown> = Promise.resolve();
  let last = -Infinity;

  async function throttled<T>(work: () => Promise<T>): Promise<T> {
    const turn = queue.then(async () => {
      const wait = last + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      last = now();
      return work();
    });
    queue = turn.catch(() => undefined);
    return turn;
  }

  return {
    geocode: (phrase) =>
      throttled(async () => {
        const params = new URLSearchParams({
          q: `${phrase}, Москва`,
          format: 'jsonv2',
          limit: '1',
          countrycodes: 'ru',
          viewbox: VIEWBOX,
          bounded: '1',
          'accept-language': 'ru',
        });
        const response = await request(`${SEARCH_URL}?${params}`, {
          headers: { 'User-Agent': options.userAgent },
          signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
        });
        if (!response.ok) throw new Error(`Nominatim answered ${response.status}`);
        const [first] = Results.parse(await response.json());
        if (!first) return null;
        const location = { lat: first.lat, lon: first.lon };
        if (!insideMoscow(location)) return null;
        const label = first.name || first.display_name.split(',')[0]?.trim() || first.display_name;
        return { label, location };
      }),
  };
}
