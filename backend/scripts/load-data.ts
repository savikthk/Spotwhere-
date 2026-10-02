import { readFile } from 'node:fs/promises';
import { loadConfig } from '../src/config.ts';
import { loadMigrations, migrate } from '../src/db/migrate.ts';
import { createPool, withTransaction } from '../src/db/pool.ts';
import { insideMoscow } from '../src/domain/geo.ts';
import type { Venue } from '../src/domain/models.ts';
import * as places from '../src/repositories/places.ts';
import * as venues from '../src/repositories/venues.ts';
import { withBaseline } from './baseline.ts';

interface RawVenue {
  id: number;
  name: string;
  description?: string;
  address?: string;
  tags?: string[];
  avg_bill: number;
  maps_url: string;
  lat: number;
  lon: number;
}

const venuesFile = process.argv[2] ?? new URL('../../venues.json', import.meta.url);
const placesFile = new URL('../data/places.json', import.meta.url);

function toVenue(raw: RawVenue): Venue | null {
  const location = { lat: Number(raw.lat), lon: Number(raw.lon) };
  if (!raw.name?.trim() || !insideMoscow(location)) return null;
  return {
    id: raw.id,
    name: raw.name.trim(),
    description: raw.description ?? '',
    address: raw.address ?? '',
    tags: withBaseline(raw.tags ?? []),
    avgBill: raw.avg_bill,
    mapsUrl: raw.maps_url,
    location,
  };
}

const rawVenues = JSON.parse(await readFile(venuesFile, 'utf8')) as RawVenue[];
const loadedVenues = rawVenues.map(toVenue).filter((venue): venue is Venue => venue !== null);
const loadedPlaces = (
  JSON.parse(await readFile(placesFile, 'utf8')) as {
    id: number;
    kind: 'metro' | 'district';
    name: string;
    lat: number;
    lon: number;
    area?: number[][][][];
  }[]
).map((place) => ({
  id: place.id,
  kind: place.kind,
  name: place.name,
  location: { lat: place.lat, lon: place.lon },
  area: place.area ?? null,
}));

const pool = createPool(loadConfig().databaseUrl, { onError: () => undefined });
try {
  await migrate(pool, await loadMigrations());
  await withTransaction(pool, async (client) => {
    await venues.replaceAll(client, loadedVenues);
    await places.replaceAll(client, loadedPlaces);
  });
  console.log(
    `venues: ${loadedVenues.length} of ${rawVenues.length}, places: ${loadedPlaces.length} ` +
      `(${loadedPlaces.filter((place) => place.kind === 'metro').length} metro stations)`,
  );
} finally {
  await pool.end();
}
