import type { Queryable } from '../db/pool.ts';
import type { Place, PlaceKind } from '../domain/models.ts';

interface PlaceRow {
  id: number;
  kind: PlaceKind;
  name: string;
  aliases: string[];
  lat: number;
  lon: number;
}

export interface NewPlace extends Place {
  area: number[][][][] | null;
}

export async function listAll(db: Queryable): Promise<Place[]> {
  const { rows } = await db.query<PlaceRow>(
    `select id, kind, name, aliases, st_y(location::geometry) as lat, st_x(location::geometry) as lon
       from places
      order by id`,
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    aliases: row.aliases,
    location: { lat: row.lat, lon: row.lon },
  }));
}

export async function replaceAll(db: Queryable, places: readonly NewPlace[]): Promise<void> {
  await db.query('delete from places');
  for (const place of places) {
    await db.query(
      `insert into places (id, kind, name, location, area, aliases)
       values ($1, $2, $3, st_setsrid(st_makepoint($4, $5), 4326)::geography,
               case when $6::text is null then null
                    else st_multi(st_makevalid(st_setsrid(st_geomfromgeojson($6), 4326)))::geography end,
               $7)`,
      [
        place.id,
        place.kind,
        place.name,
        place.location.lon,
        place.location.lat,
        place.area ? JSON.stringify({ type: 'MultiPolygon', coordinates: place.area }) : null,
        [...(place.aliases ?? [])],
      ],
    );
  }
}
