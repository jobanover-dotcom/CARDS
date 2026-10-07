import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', '.next/', 'out/', '**/*.d.ts', '**/*.config.*', '**/mock*'],
    },
  },
  resolve: {
    // Mirrors the tsconfig "@/paths" map for the specifiers this repo actually
    // uses. Previously only "@" -> "./src" was mapped, which silently broke
    // both `vi.mock('@/lib/prisma')` (resolved to a non-existent path) and
    // any test that reached a server action importing '@/src/lib/...'.
    alias: [
      { find: /^@\/src\/(.*)$/, replacement: path.resolve(__dirname, './src/$1') },
      { find: /^@\/lib\/(.*)$/, replacement: path.resolve(__dirname, './lib/$1') },
      { find: /^@\/actions\/(.*)$/, replacement: path.resolve(__dirname, './actions/$1') },
      { find: /^@\/app\/(.*)$/, replacement: path.resolve(__dirname, './app/$1') },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, './src/$1') },
    ],
  },
})