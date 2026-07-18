// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/dist-types/**", "**/dashboard-dist/**", "**/coverage/**", "**/node_modules/**"]
  },
  {
    // Plain Node scripts (e.g. packages/server/scripts/copy-dashboard.mjs) -
    // TypeScript files get Node globals from @types/node automatically;
    // these don't, so `no-undef` would otherwise flag console/process.
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly"
      }
    }
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": "warn"
    }
  }
);
