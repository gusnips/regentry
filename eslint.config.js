import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

/**
 * Runtime boundary: files outside a ui/ folder must not import React/zustand.
 * This keeps the service-worker bundle React-free.
 */
const noReactOutsideUi = {
  files: ["**/*.{ts,tsx}"],
  ignores: ["**/ui/**", "**/entrypoints/**", "**/__tests__/**", ".wxt/**", ".output/**", "refs/**"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          { name: "react", message: "React is UI-only — import from within a ui/ folder." },
          { name: "react-dom", message: "React is UI-only — import from within a ui/ folder." },
          { name: "zustand", message: "zustand is UI-only — import from within a ui/ folder." },
        ],
        patterns: [
          {
            group: ["react/*", "react-dom/*"],
            message: "React is UI-only — import from within a ui/ folder.",
          },
          {
            group: ["*/ui/*"],
            message: "UI modules are UI-only — import from within a ui/ folder.",
          },
        ],
      },
    ],
  },
};

export default tseslint.config(
  { ignores: [".wxt/**", ".output/**", "refs/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, chrome: "readonly" },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs["recommended-latest"].rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  noReactOutsideUi,
);
