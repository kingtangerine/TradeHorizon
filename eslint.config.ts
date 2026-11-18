import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'build', 'node_modules', 'server/data', 'coverage', 'android', '.claude'] },

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
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // The klinecharts types are loose in places; casts there are deliberate.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Server, scripts and config files (Node, TypeScript)
  {
    files: ['server/**/*.ts', 'scripts/**/*.ts', '*.config.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
    },
  },

  // Service worker
  {
    files: ['src/sw/**/*.ts'],
    languageOptions: { globals: globals.serviceworker },
  },
)
