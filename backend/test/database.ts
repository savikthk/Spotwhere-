import { createPool, type Pool } from '../src/db/pool.ts';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://spotwhere:spotwhere_pass@127.0.0.1:5433/spotwhere_test';

export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to use database "${name}" for tests, its name must end with _test`);
  }
}

let shared: Pool | undefined;

export function testPool(): Pool {
  assertTestDatabase(TEST_DATABASE_URL);
  shared ??= createPool(TEST_DATABASE_URL, {
    max: 4,
    onError: () => undefined,
  });
  return shared;
}

export async function closeTestPool(): Promise<void> {
  await shared?.end();
  shared = undefined;
}

export async function resetDatabase(pool: Pool = testPool()): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    `select tablename from pg_tables
      where schemaname = 'public' and tablename not in ('schema_migrations', 'spatial_ref_sys')`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((row) => `"${row.tablename}"`).join(', ');
  await pool.query(`truncate ${tables} restart identity cascade`);
}
