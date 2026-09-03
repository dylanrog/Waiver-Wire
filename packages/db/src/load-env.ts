import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

/**
 * Load the repo-root `.env.local` for standalone tooling (migrate, seed). The
 * Next.js app loads its own env — this is only for scripts run outside it.
 *
 * `override: true` on purpose: `.env.local` is the source of truth here, and a
 * stale machine-level `DATABASE_URL` from another project must not win.
 */
export function loadEnv(): void {
  for (const rel of ["../../../.env.local", "../../../.env"]) {
    const path = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(path)) {
      config({ path, override: true });
      return;
    }
  }
}
