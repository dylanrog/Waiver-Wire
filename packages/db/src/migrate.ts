import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { loadEnv } from "./load-env";

loadEnv();

const url = process.env.DIRECT_URL;
if (!url) {
  throw new Error("DIRECT_URL is not set — needed for migrations. See .env.example.");
}

const client = postgres(url, { max: 1 });
await migrate(drizzle(client), {
  migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
});
await client.end();
console.log("migrations applied");
