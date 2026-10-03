import type { Queryable } from '../db/pool.ts';

export const WEIGHT_LIMIT = 2;

export async function forUser(db: Queryable, userId: number): Promise<Map<string, number>> {
  const { rows } = await db.query<{ tag: string; weight: number }>(
    'select tag, weight from user_tag_weights where user_id = $1',
    [userId],
  );
  return new Map(rows.map((row) => [row.tag, row.weight]));
}

export async function add(
  db: Queryable,
  userId: number,
  tags: readonly string[],
  delta: number,
): Promise<void> {
  if (tags.length === 0) return;
  await db.query(
    `insert into user_tag_weights (user_id, tag, weight)
     select $1, tag, $3 from unnest($2::text[]) as tag
     on conflict (user_id, tag) do update
       set weight = greatest(-$4::float8, least($4::float8, user_tag_weights.weight + excluded.weight))`,
    [userId, [...new Set(tags)], delta, WEIGHT_LIMIT],
  );
}
