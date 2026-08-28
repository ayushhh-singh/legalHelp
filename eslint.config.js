import js from '@eslint/js'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'public/fonts/**', 'src/components/ui/**'],
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
        {
          name: 'SpeechRecognition',
          message:
            'Speech recognition is a NETWORK service in Chrome — the audio is streamed off the device. Only src/lib/voice.ts may construct one, and only after consent.',
        },
        {
          name: 'webkitSpeechRecognition',
          message:
            'Speech recognition is a NETWORK service in Chrome — the audio is streamed off the device. Only src/lib/voice.ts may construct one, and only after consent.',
        },
      ],
    },
  },

  // The single network seam. `src/ai/providers/wire.ts` is the only module in
  // the application that may call fetch, and it may only do so on a tier the
  // reader explicitly consented to. Granting the exception here, rather than
  // quietly reaching the global as `globalThis.fetch`, keeps the audit question
  // "what in this app can talk to the network?" answerable from this file.
  {
    files: ['src/ai/providers/wire.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },

  // The second seam. `SpeechRecognition` looks like a browser API and behaves
  // like a network client unless `processLocally` is set — Chrome otherwise
  // streams the captured audio to Google. src/lib/voice.ts is the only module
  // that may construct one, and it always sets that flag (ADR-017). Confining
  // it to one file is what keeps that guarantee checkable by reading.
  {
    files: ['src/lib/voice.ts'],
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
