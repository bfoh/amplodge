import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default tseslint.config(
  // Ignored paths — ESLint 9 flat config uses `ignores` instead of CLI --ext
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'netlify/**',           // includes netlify/functions/*.js + node_modules
      '*.config.js',
      '*.config.cjs',
      '*.cjs',                 // root-level CJS debug files (debug-*.cjs, check.cjs, etc.)
      'scripts/**',
      'supabase/**',
      'resend/**',
      'docs/**',
      'test_resolution.js',    // root one-off test script
      'fix-warmtable.js',      // root one-off fix script
      'functions/**',          // legacy orphan dir (deleted by Phase 1, but defensive)
      'public/**',             // service worker + static assets (no need to lint)
    ],
  },

  // Base JS recommended
  js.configs.recommended,

  // TypeScript recommended (non-type-checked — fast)
  ...tseslint.configs.recommended,

  // Project rules
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // React Hooks
      ...reactHooks.configs.recommended.rules,

      // React Refresh
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // Loose rules — match Phase 1 baseline. Strict mode arrives in Phase 2D.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-prototype-builtins': 'warn',
      'no-async-promise-executor': 'warn',
    },
  },
)
