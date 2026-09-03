import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "sources",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
