import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve('src/core'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    globals: true,
    // Only the headless core is tested for now. Once UI tests appear, a
    // separate project with environment: 'jsdom' will be added here.
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Coverage is measured for the core only — see §11.3 docs/PROJECT.md.
      // Chasing 100% on IPC and UI only breeds hollow tests.
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/**/*.{test,spec}.ts', 'src/core/types.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100
      }
    }
  }
})
