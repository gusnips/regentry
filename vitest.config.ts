import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/__tests__/**/*.test.ts"],
    setupFiles: ["src/test-setup.ts"],
  },
});
