import pg from 'pg';

function safeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`int8 value ${value} exceeds the safe integer range`);
  }
  return parsed;
}

function safeIntegerArray(value: string): (number | null)[] {
  const inner = value.slice(1, -1);
  if (inner === '') return [];
  return inner.split(',').map((item) => (item === 'NULL' ? null : safeInteger(item)));
}

type TypeId = Parameters<typeof pg.types.getTypeParser>[0];
const INT8_ARRAY_OID = 1016 as TypeId;

pg.types.setTypeParser(pg.types.builtins.INT8, safeInteger);
pg.types.setTypeParser(INT8_ARRAY_OID, safeIntegerArray);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);

export interface Queryable {
  query<Row extends pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<Row>>;
}

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export interface PoolOptions {
  max?: number;
  onError: (error: Error) => void;
}

export function createPool(connectionString: string, { max = 10, onError }: PoolOptions): Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    application_name: 'spotwhere',
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
  });
  pool.on('error', onError);
  return pool;
}

export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    client.release();
    return result;
  } catch (error) {
    const rolledBack = await client.query('rollback').then(
      () => true,
      () => false,
    );
    client.release(rolledBack ? undefined : true);
    throw error;
  }
}

export async function one<Row extends pg.QueryResultRow>(
  db: Queryable,
  text: string,
  values?: unknown[],
): Promise<Row> {
  const result = await db.query<Row>(text, values);
  const [row] = result.rows;
  if (!row) {
    throw new Error('Expected exactly one row, got none');
  }
  return row;
}

export async function maybeOne<Row extends pg.QueryResultRow>(
  db: Queryable,
  text: string,
  values?: unknown[],
): Promise<Row | null> {
  const result = await db.query<Row>(text, values);
  return result.rows[0] ?? null;
}

export function jsonb(value: unknown): string {
  return JSON.stringify(value);
}
