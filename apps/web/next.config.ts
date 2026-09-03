import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import type { NextConfig } from "next";

// This app lives in a monorepo — load the repo-root .env.local (Next only looks
// in apps/web/). `override` so a stale machine-level DATABASE_URL can't win.
for (const rel of ["../../.env.local", "../../.env"]) {
  const path = fileURLToPath(new URL(rel, import.meta.url));
  if (existsSync(path)) {
    config({ path, override: true });
    break;
  }
}

const nextConfig: NextConfig = {
  transpilePackages: [
    "@waiver-wire/shared",
    "@waiver-wire/db",
    "@waiver-wire/sleeper",
    "@waiver-wire/sources",
    "@waiver-wire/projections",
  ],
  // postgres.js is a Node driver — don't bundle it.
  serverExternalPackages: ["postgres"],
  // Linting is a dedicated CI step (`pnpm lint`) over the whole workspace.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
