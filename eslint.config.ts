import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  { ignores: ["build/**"] },
  eslintConfigPrettier,
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts}"],
    ignores: ["**/*.config.{ts}", "*.reference.ts"],
    plugins: {
      "@stylistic": stylistic,
    },
    rules: {
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "interface",
          format: ["PascalCase"],
          custom: {
            regex: "^I[A-Z]",
            match: true,
          },
        },
      ],
      "@typescript-eslint/no-empty-interface": 0,
      "@typescript-eslint/typedef": 0,
      "@typescript-eslint/no-explicit-any": "off",
      "spaced-comment": ["error", "always", {
        line: {
          markers: ["/"],
        },
        block: {
          markers: ["!"],
          exceptions: ["*"],
          balanced: true,
        },
      }],
      "comma-dangle": ["error", "always-multiline"],
      "max-len": ["error", {
        code: 100,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreComments: true,
      }],
      semi: "error",
      "no-multiple-empty-lines": ["error", { max: 1 }],
      "no-restricted-properties": [2, {
        property: "goto",
        message: "Please use gotoAndCheckUrl instead of page.goto",
      }, {
        property: "waitForURL",
        message: "Please use gotoAndCheckUrl instead of page.waitForURL",
      }],
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-restricted-syntax": [
        "error",
        {
          selector: "Property[key.name='ephemeral'][value.value=true]",
          message: "Use 'flags: MessageFlags.Ephemeral' instead of 'ephemeral: true'.",
        },
      ],
    },
  },
];
