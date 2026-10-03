import pg from 'pg';
import { loadMigrations, migrate } from '../src/db/migrate.ts';
import { createPool } from '../src/db/pool.ts';
import { assertTestDatabase, TEST_DATABASE_URL } from './database.ts';

async function ensureDatabase(url: string) {
  const target = new URL(url);
  const name = target.pathname.replace(/^\//, '');
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (rowCount === 0) {
      await client.query(`create database "${name.replaceAll('"', '')}"`);
    }
  } finally {
    await client.end();
  }
}

export default async function setup() {
  assertTestDatabase(TEST_DATABASE_URL);
  await ensureDatabase(TEST_DATABASE_URL);
  const pool = createPool(TEST_DATABASE_URL, { max: 1, onError: () => undefined });
  try {
    await pool.query('drop schema public cascade');
    await pool.query('create schema public');
    await migrate(pool, await loadMigrations());
  } finally {
    await pool.end();
  }
}
