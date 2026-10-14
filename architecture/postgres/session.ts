import { assertUuid } from "./analyzer.js";
import type { Queryable } from "./types.js";

export type RequestDatabaseRole = "comichuddle_collector" | "comichuddle_valuator" | "comichuddle_moderator";
export interface DatabaseSessionContext { userId: string; role: RequestDatabaseRole; reviewPreview?: boolean }
export interface PoolClient extends Queryable { release(): void }
export interface Pool { connect(): Promise<PoolClient> }
export interface SessionDatabase {
  withSession<T>(context: DatabaseSessionContext, work: (db: Queryable) => Promise<T>): Promise<T>;
}
const SET_ROLE: Record<RequestDatabaseRole, string> = {
  comichuddle_collector: "SET LOCAL ROLE comichuddle_collector",
  comichuddle_valuator: "SET LOCAL ROLE comichuddle_valuator",
  comichuddle_moderator: "SET LOCAL ROLE comichuddle_moderator",
};

/** Server-only adapter. Never give a browser DB credentials or let HTTP JSON pick context/role. */
export function postgresSessionDatabase(pool: Pool): SessionDatabase {
  return {
    async withSession<T>(context: DatabaseSessionContext, work: (db: Queryable) => Promise<T>): Promise<T> {
      assertUuid(context.userId);
      if (!Object.hasOwn(SET_ROLE, context.role)) throw new TypeError("Unsupported database role");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(SET_ROLE[context.role]); // fixed whitelist string, no input interpolation
        await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.review_preview',$2,true)",
          [context.userId, context.reviewPreview === true ? "true" : "false"]);
        const result = await work(client);
        await client.query("COMMIT"); // also runs deferred cross-table contracts
        return result;
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch { /* preserve the original failure */ }
        throw error;
      } finally { client.release(); }
    },
  };
}
