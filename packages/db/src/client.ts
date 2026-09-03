import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * Driver-agnostic Drizzle handle. The app uses postgres.js against Supabase;
 * tests use pglite. Query helpers accept this so both work.
 */
export type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Connect to Postgres via the Supabase transaction pooler (port 6543), where
 * prepared statements must be disabled. Migrations use a separate path — see
 * `migrate.ts` and `DIRECT_URL`.
 */
export function createDb(connectionString: string): Db {
  const client = postgres(connectionString, { prepare: false });
  return drizzle(client, { schema });
}
