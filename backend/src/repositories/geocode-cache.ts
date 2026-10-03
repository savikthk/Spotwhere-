import type { Queryable } from '../db/pool.ts';
import type { GeoPoint } from '../domain/models.ts';

export interface CachedGeocode {
  label: string | null;
  location: GeoPoint | null;
  createdAt: Date;
}

interface CacheRow {
  label: string | null;
  lat: number | null;
  lon: number | null;
  created_at: Date;
}

export async function find(db: Queryable, key: string): Promise<CachedGeocode | null> {
  const { rows } = await db.query<CacheRow>(
    `select label, st_y(location::geometry) as lat, st_x(location::geometry) as lon, created_at
       from geocode_cache where query_key = $1`,
    [key],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    label: row.label,
    location: row.lat !== null && row.lon !== null ? { lat: row.lat, lon: row.lon } : null,
    createdAt: row.created_at,
  };
}

export async function save(
  db: Queryable,
  key: string,
  found: { label: string; location: GeoPoint } | null,
  now: Date,
): Promise<void> {
  await db.query(
    `insert into geocode_cache (query_key, label, location, created_at)
     values ($1, $2, case when $3::float8 is null then null
                          else st_setsrid(st_makepoint($3, $4), 4326)::geography end, $5)
     on conflict (query_key) do update
       set label = excluded.label, location = excluded.location, created_at = excluded.created_at`,
    [key, found?.label ?? null, found?.location.lon ?? null, found?.location.lat ?? null, now],
  );
}
