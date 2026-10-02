import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Pool, PoolClient } from './pool.ts';

export interface Migration {
  version: string;
  sql: string;
  checksum: string;
}

export class MigrationError extends Error {
  readonly version: string;

  constructor(version: string, message: string) {
    super(message);
    this.name = 'MigrationError';
    this.version = version;
  }
}

const MIGRATION_FILE = /^(\d{4}_[a-z0-9_]+)\.sql$/;
const ADVISORY_LOCK_ID = 727_274_101;

export const defaultMigrationsDir = new URL('../../migrations/', import.meta.url);

export function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export async function loadMigrations(dir: URL = defaultMigrationsDir): Promise<Migration[]> {
  const base = dir.href.endsWith('/') ? dir : new URL(`${dir.href}/`);
  const files = (await readdir(base)).filter((file) => MIGRATION_FILE.test(file)).sort();
  return Promise.all(
    files.map(async (file) => {
      const sql = await readFile(new URL(file, base), 'utf8');
      return { version: file.replace(/\.sql$/, ''), sql, checksum: checksum(sql) };
    }),
  );
}

function verifyHistory(known: Map<string, string>, migrations: Migration[]): Migration[] {
  const onDisk = new Set(migrations.map((migration) => migration.version));
  for (const version of known.keys()) {
    if (!onDisk.has(version)) {
      throw new MigrationError(version, `Database has migration ${version} that this build does not know`);
    }
  }
  for (const migration of migrations) {
    const applied = known.get(migration.version);
    if (applied !== undefined && applied !== migration.checksum) {
      throw new MigrationError(
        migration.version,
        `Migration ${migration.version} was changed after it had been applied`,
      );
    }
  }
  const latestApplied = [...known.keys()].sort().at(-1);
  const pending = migrations.filter((migration) => !known.has(migration.version));
  const outOfOrder = pending.find(
    (migration) => latestApplied !== undefined && migration.version < latestApplied,
  );
  if (outOfOrder) {
    throw new MigrationError(
      outOfOrder.version,
      `Migration ${outOfOrder.version} is older than the already applied ${latestApplied ?? ''}`,
    );
  }
  return pending;
}

async function applyPending(client: PoolClient, migrations: Migration[]): Promise<string[]> {
  await client.query(
    `create table if not exists schema_migrations (
      version text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`,
  );
  const { rows } = await client.query<{ version: string; checksum: string }>(
    'select version, checksum from schema_migrations',
  );
  const pending = verifyHistory(new Map(rows.map((row) => [row.version, row.checksum])), migrations);
  const applied: string[] = [];
  for (const migration of pending) {
    await client.query('begin');
    await client.query(migration.sql);
    await client.query('insert into schema_migrations (version, checksum) values ($1, $2)', [
      migration.version,
      migration.checksum,
    ]);
    await client.query('commit');
    applied.push(migration.version);
  }
  return applied;
}

export async function migrate(pool: Pool, migrations: Migration[]): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [ADVISORY_LOCK_ID]);
    const applied = await applyPending(client, migrations);
    await client.query('select pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]);
    client.release();
    return applied;
  } catch (error) {
    const healthy = await client
      .query('rollback')
      .then(() => client.query('select pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]))
      .then(
        () => true,
        () => false,
      );
    client.release(healthy ? undefined : true);
    throw error;
  }
}
