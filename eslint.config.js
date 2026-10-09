import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'server/data', 'coverage'] },

  // App code (browser, TypeScript, React)
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Hooks bugs are the most expensive kind in a React app; keep these as errors.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
      // The klinecharts types are loose in places; casts there are deliberate.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Server, build scripts and config (Node, plain JavaScript)
  {
    files: ['server/**/*.mjs', 'scripts/**/*.mjs', '*.config.{js,ts}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
  {
    files: ['*.config.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },

  // Service worker
  {
    files: ['public/sw.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.serviceworker },
  },
)
