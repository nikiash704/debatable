import { defineConfig } from "vitest/config";

// Unit tests only (pure TypeScript engine and helpers). No Worker runtime needed.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
