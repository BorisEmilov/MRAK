// Shared flat ESLint config for the whole monorepo.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import security from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.astro/**',
      '**/.turbo/**',
      '**/src/generated/**',
      '**/storybook-static/**',
      'docs/phaser-skills/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  // Security lint (SAST in every PR; docs/security/test-report.md).
  security.configs.recommended,
  {
    rules: {
      // Typed code indexes objects by design (Records keyed by validated ids): too noisy.
      'security/detect-object-injection': 'off',
      // XSS sinks: React escapes by default; raw HTML only through reviewed exceptions.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'No raw HTML in React (XSS). Render text, or add a reviewed eslint-disable.',
        },
        {
          selector:
            "MemberExpression[property.name='innerHTML'][parent.type='AssignmentExpression']",
          message: 'No innerHTML assignments (XSS).',
        },
      ],
    },
  },
  {
    // Build tooling, CLIs and tests read local, repo-controlled paths.
    files: [
      '**/scripts/**',
      '**/build/**',
      '**/*.test.{ts,tsx}',
      '**/tests/**',
      '**/*.config.{js,ts,mjs}',
      'packages/content-schema/src/node/**',
    ],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-regexp': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: [
      'apps/game/**/*.{ts,tsx}',
      'apps/studio-web/**/*.{ts,tsx}',
      'packages/ui-kit/**/*.{ts,tsx}',
    ],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['services/**/*.ts', '**/*.config.{js,ts}', 'tests/security/**'],
    languageOptions: { globals: globals.node },
  },
  {
    // packages/core must stay pure: no Phaser, no React, no DOM.
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['phaser', 'phaser/*'], message: 'core is engine-agnostic: no Phaser.' },
            { group: ['react', 'react-dom', 'react/*'], message: 'core is UI-agnostic: no React.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'navigator'],
    },
  },
  prettier,
);
