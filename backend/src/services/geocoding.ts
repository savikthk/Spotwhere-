import type { Pool } from '../db/pool.ts';
import { nameKey } from '../domain/text.ts';
import type { Geocoder, Logger } from '../ports.ts';
import * as geocodeCache from '../repositories/geocode-cache.ts';

const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OUTAGE_PAUSE_MS = 120_000;

export interface CachedGeocoderDependencies {
  pool: Pool;
  geocoder: Geocoder;
  logger: Logger;
  now?: () => Date;
}

export function createCachedGeocoder({
  pool,
  geocoder,
  logger,
  now = () => new Date(),
}: CachedGeocoderDependencies): Geocoder {
  let pausedUntil = 0;
  return {
    async geocode(phrase) {
      const key = nameKey(phrase);
      if (key.length === 0) return null;
      const cached = await geocodeCache.find(pool, key);
      if (cached?.location) return { label: cached.label ?? phrase, location: cached.location };
      const at = now();
      if (cached && at.getTime() - cached.createdAt.getTime() < MISS_TTL_MS) return null;
      if (at.getTime() < pausedUntil) return null;
      let found;
      try {
        found = await geocoder.geocode(phrase);
      } catch (error) {
        pausedUntil = at.getTime() + OUTAGE_PAUSE_MS;
        logger.warn({ err: error, phrase }, 'geocoding failed, pausing it for two minutes');
        return null;
      }
      await geocodeCache.save(pool, key, found, at);
      return found;
    },
  };
}
