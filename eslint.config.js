import js from "@eslint/js";

export default [
  { ignores: ["node_modules/**", "test/fixtures/**"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { console: "readonly", process: "readonly", URL: "readonly" },
    },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // localeCompare with no locale sorts by the machine's locale, so output order would
      // depend on where the code ran.
      "no-restricted-syntax": [
        "error",
        {
          selector: 'CallExpression[callee.property.name="localeCompare"][arguments.length<2]',
          message:
            'Pass an explicit locale, as in localeCompare(other, "en"), so the order does not depend on the machine.',
        },
      ],
    },
  },
];
