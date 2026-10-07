import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Config for the opt-in LIVE-DATABASE end-to-end run.
 *
 * Deliberately does NOT load `vitest.setup.ts`, which installs a fake Prisma
 * client. These tests must talk to real Postgres, so they get their own config
 * with the real singleton and no component/auth mocks. Only the Supabase
 * session lookup is stubbed, inside the test file itself.
 *
 * Run with: npm run test:e2e:live
 */
export default defineConfig({
  // The Prisma client and its `pg` driver are native/CJS dependencies. Vitest
  // must hand them to Node as-is: transforming them through Vite's SSR
  // pipeline makes the first `pg` connection hang indefinitely.
  ssr: {
    external: ['pg', 'pg-native', '@prisma/client', '@prisma/adapter-pg'],
  },
  optimizeDeps: {
    exclude: ['pg', '@prisma/client', '@prisma/adapter-pg'],
  },
  test: {
    server: {
      deps: {
        external: [/pg/, /@prisma/],
      },
    },
    environment: 'node',
    // Loads .env so process.env.DATABASE_URL exists before lib/prisma.ts runs.
    setupFiles: ['./vitest.live.setup.ts'],
    include: ['src/lib/__tests__/e2e/**/*.test.ts'],
    // A live database round-trips; give it room but never hang forever.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Sequential: the suite asserts a global before/after fingerprint, so
    // parallel files against one database would race.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      exclude: ['node_modules/', '.next/', 'out/', '**/*.d.ts', '**/*.config.*', '**/mock*'],
    },
  },
  resolve: {
    // Mirrors the tsconfig "@/paths" map for the specifiers this repo uses.
    alias: [
      { find: /^@\/src\/(.*)$/, replacement: path.resolve(__dirname, './src/$1') },
      { find: /^@\/lib\/(.*)$/, replacement: path.resolve(__dirname, './lib/$1') },
      { find: /^@\/actions\/(.*)$/, replacement: path.resolve(__dirname, './actions/$1') },
      { find: /^@\/app\/(.*)$/, replacement: path.resolve(__dirname, './app/$1') },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, './src/$1') },
    ],
  },
})
