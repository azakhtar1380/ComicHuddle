import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';
import { getPool } from './postgres';
import * as schema from './schema';

// Keep every existing guarded batch on one transaction/connection, including
// Drizzle result mapping, and retry PostgreSQL serialization conflicts.
const transactionClient = new AsyncLocalStorage<PoolClient>();
const driver = {
  query(...args: unknown[]) {
    const connection = transactionClient.getStore() || getPool();
    return (connection.query as (...args: unknown[]) => Promise<unknown>).apply(connection, args);
  },
};

export function getDb() {
  const db = drizzle(driver as unknown as ReturnType<typeof getPool>, { schema });
  return Object.assign(db, {
    async batch<const T extends readonly PromiseLike<unknown>[]>(queries: T): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
      if (transactionClient.getStore()) throw new Error('Nested database batches are unsupported.');
      for (let attempt = 0; ; attempt++) {
        const client = await getPool().connect();
        try {
          await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
          await client.query("SELECT pg_advisory_xact_lock(hashtext('comichuddle-web-guard'))");
          const results = await transactionClient.run(client, async () => {
            const result: unknown[] = [];
            for (const query of queries) result.push(await query);
            return result;
          });
          await client.query('COMMIT');
          return results as { [K in keyof T]: Awaited<T[K]> };
        } catch (error) {
          await client.query('ROLLBACK');
          let cause: unknown = error, retry = false;
          for (let depth = 0; depth < 5 && cause; depth++) {
            const value = cause as { code?: string; cause?: unknown };
            if (['40001', '40P01'].includes(value.code || '')) { retry = true; break; }
            cause = value.cause;
          }
          if (!retry || attempt >= 2) throw error;
        } finally { client.release(); }
      }
    },
  });
}
