import js from '@eslint/js'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'public/fonts/**',
      'src/components/ui/**',
      // worker/ is a separate package with its own tsconfig, its own
      // dependency tree and its own CI job (ci.yml, job `worker`). Type-aware
      // linting here would need it added to the app's tsconfig project, which
      // is the opposite of what keeping it separate is for. Listed explicitly
      // rather than left to fall through no `files` pattern by accident —
      // ADR-037.
      'worker/**',
    ],
  },

  // Application source: type-aware linting.
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      // eslint-plugin-react-hooks 7 folds the React Compiler rules (purity,
      // immutability, set-state-in-effect, …) into `recommended`. The plugin is
      // registered above rather than spread wholesale so this block keeps its
      // own `files` scope.
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      /*
        A scrollable region must be keyboard-operable, or the only way to reach
        the columns past its edge is a mouse — axe reports it as
        `scrollable-region-focusable`, and the fix is `role="region"` with
        `tabIndex={0}`. The default configuration of this rule allows that only
        on `tabpanel`, so the lint rule and the axe rule contradict each other
        on the very markup that satisfies WCAG. `region` is added rather than
        the rule being disabled at the one call site, so the next scrollable
        table gets the same treatment without a fresh argument.
      */
      'jsx-a11y/no-noninteractive-tabindex': [
        'error',
        { tags: [], roles: ['tabpanel', 'region'], allowExpressionValues: true },
      ],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Hard rule: no user data leaves the device. Flag the usual suspects.
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'No network requests may carry user data (see CLAUDE.md hard rules).' },
      ],
    },
  },

  // The two network seams. `src/ai/providers/wire.ts` may call fetch to reach
  // a tier the reader explicitly consented to (cross-origin, opt-in);
  // `src/lib/dataUpdates.ts` may call it to re-fetch the SAME same-origin
  // dataset manifest already bundled into the build, for "Check for data
  // updates" in Settings (ADR-028). Granting both exceptions here, rather
  // than reaching the global as `globalThis.fetch`, keeps the audit question
  // "what in this app can talk to the network?" answerable from this file.
  {
    files: ['src/ai/providers/wire.ts', 'src/lib/dataUpdates.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },

  // TS config files belong to tsconfig.node.json, not the app project.
  {
    files: ['*.config.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // Build + data scripts run in Node, untyped, and may use the network.
  {
    files: ['scripts/**/*.mjs', '*.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
)
