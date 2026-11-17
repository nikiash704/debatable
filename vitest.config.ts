import { defineConfig } from "vitest/config";

// Unit tests only (pure TypeScript engine, helpers and the Worker's pure handlers). No Worker runtime needed.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "worker/**/*.test.ts"],
    environment: "node",
  },
});
