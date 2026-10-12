import { defineConfig } from 'eslint/config'
import nextPlugin from '@next/eslint-plugin-next'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default defineConfig([
  {
    ignores: ['.next/', 'node_modules/', 'out/', '*.config.*', '*.config.mjs'],
  },
  ...tseslint.configs.recommended,
  {
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs['recommended-latest'].rules,
      // Gate CI on missing effect deps — warnings don't fail `next lint`
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // Test fixtures are dynamic shapes standing in for Prisma rows, so `any` is
    // the honest type there. `__tests__/helpers/` holds the shared doubles those
    // files import, and needs the same exemption as the files themselves.
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/__tests__/helpers/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
])