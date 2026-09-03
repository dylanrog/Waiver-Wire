import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@waiver-wire/shared"],
  // Linting is a dedicated CI step (`pnpm lint`) over the whole workspace.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
