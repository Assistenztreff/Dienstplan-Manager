import tseslint from "typescript-eslint";
import playwright from "eslint-plugin-playwright";

export default tseslint.config(
  {
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.e2e.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      playwright,
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "playwright/missing-playwright-await": "error",
    },
  },
);
