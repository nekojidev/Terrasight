import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const HEX = "/#[0-9a-fA-F]{3,8}\\b/";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/generated/**",
      "**/storybook-static/**",
      "design/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // design/README: no hard-coded hex in UI code; use design/tokens.css variables.
    files: ["packages/ui/src/**/*.{ts,tsx}", "apps/web/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `Literal[value=${HEX}]`,
          message: "No hex colours in components: use a design/tokens.css variable.",
        },
        {
          selector: `TemplateElement[value.raw=${HEX}]`,
          message: "No hex colours in components: use a design/tokens.css variable.",
        },
      ],
    },
  },
);
