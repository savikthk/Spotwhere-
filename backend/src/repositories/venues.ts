import type { Queryable } from '../db/pool.ts';
import type { GeoPoint, Venue } from '../domain/models.ts';
import type { Candidate } from '../domain/rank.ts';

interface VenueRow {
  id: number;
  name: string;
  description: string;
  address: string;
  tags: string[];
  avg_bill: number;
  maps_url: string;
  lat: number;
  lon: number;
  distance_m: number | null;
}

export interface VenueSearch {
  center: GeoPoint | null;
  radiusM: number | null;
  districtId: number | null;
  bufferM: number;
  category: string | null;
  cuisines: readonly string[];
  budgetMax: number | null;
  limit: number;
}

const COLUMNS = `v.id, v.name, v.description, v.address, v.tags, v.avg_bill, v.maps_url,
  st_y(v.location::geometry) as lat, st_x(v.location::geometry) as lon`;

function toVenue(row: VenueRow): Venue {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    address: row.address,
    tags: row.tags,
    avgBill: row.avg_bill,
    mapsUrl: row.maps_url,
    location: { lat: row.lat, lon: row.lon },
  };
}

export async function search(db: Queryable, filter: VenueSearch): Promise<Candidate[]> {
  const values: unknown[] = [];
  const param = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const where: string[] = [];
  let distance = 'null::float8';
  if (filter.center) {
    const point = `st_setsrid(st_makepoint(${param(filter.center.lon)}, ${param(filter.center.lat)}), 4326)::geography`;
    distance = `st_distance(v.location, ${point})`;
    if (filter.districtId !== null) {
      where.push(
        `exists (select 1 from places p where p.id = ${param(filter.districtId)}
                   and st_dwithin(p.area, v.location, ${param(filter.bufferM)}))`,
      );
    } else if (filter.radiusM !== null) {
      where.push(`st_dwithin(v.location, ${point}, ${param(filter.radiusM)})`);
    }
  }
  if (filter.category !== null) where.push(`${param(filter.category)} = any(v.tags)`);
  if (filter.cuisines.length > 0) where.push(`v.tags && ${param(filter.cuisines)}::text[]`);
  if (filter.budgetMax !== null) where.push(`v.avg_bill <= ${param(filter.budgetMax)}`);
  const order = filter.center ? 'distance_m, v.id' : 'random()';
  const { rows } = await db.query<VenueRow>(
    `select ${COLUMNS}, ${distance} as distance_m
       from venues v
      ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
      order by ${order}
      limit ${param(filter.limit)}`,
    values,
  );
  return rows.map((row) => ({ venue: toVenue(row), distanceM: row.distance_m }));
}

export async function findTags(db: Queryable, id: number): Promise<string[] | null> {
  const { rows } = await db.query<{ tags: string[] }>('select tags from venues where id = $1', [id]);
  return rows[0]?.tags ?? null;
}

export async function replaceAll(db: Queryable, venues: readonly Venue[]): Promise<void> {
  await db.query('delete from venues');
  const BATCH = 1000;
  for (let start = 0; start < venues.length; start += BATCH) {
    const batch = venues.slice(start, start + BATCH);
    await db.query(
      `insert into venues (id, name, description, address, tags, avg_bill, maps_url, location)
       select v.id, v.name, v.description, v.address, t.tags, v.avg_bill, v.maps_url,
              st_setsrid(st_makepoint(v.lon, v.lat), 4326)::geography
         from jsonb_to_recordset($1::jsonb)
           as v(id bigint, name text, description text, address text, tags jsonb, avg_bill int,
                maps_url text, lat float8, lon float8)
           cross join lateral (select array(select jsonb_array_elements_text(v.tags))) as t(tags)`,
      [
        JSON.stringify(
          batch.map((venue) => ({
            id: venue.id,
            name: venue.name,
            description: venue.description,
            address: venue.address,
            tags: venue.tags,
            avg_bill: venue.avgBill,
            maps_url: venue.mapsUrl,
            lat: venue.location.lat,
            lon: venue.location.lon,
          })),
        ),
      ],
    );
  }
}
