import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { Db } from "./client";
import * as schema from "./schema";

/**
 * A fresh in-memory Postgres with every migration applied. One per test — pglite
 * instances are cheap and fully isolated, so there's no shared-state cleanup.
 */
export async function makeTestDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
  });
  return db as unknown as Db;
}
