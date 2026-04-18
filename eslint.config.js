import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import vitest from "@vitest/eslint-plugin";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: globals.node },
  },
  tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.spec.ts", "**/*.test.ts"],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      "vitest/padding-around-test-blocks": "error",
    },
  },
]);
