import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/__tests__/**/*.test.ts", "src/**/__tests__/**/*.test.tsx"],
    setupFiles: ["src/test-setup.ts"],
  },
});
