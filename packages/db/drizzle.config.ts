import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Standalone tooling (not the app) — load the repo-root .env.local explicitly.
// override: true so a stale machine-level DATABASE_URL/DIRECT_URL can't win.
for (const rel of ["../../.env.local", "../../.env"]) {
  const path = fileURLToPath(new URL(rel, import.meta.url));
  if (existsSync(path)) {
    config({ path, override: true });
    break;
  }
}

const url = process.env.DIRECT_URL;
if (!url) {
  throw new Error("DIRECT_URL is not set — needed for migrations. See .env.example.");
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
