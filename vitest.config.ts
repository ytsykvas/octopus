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
    // Наразі тестується лише headless-ядро. Коли з'являться тести UI,
    // сюди додасться окремий проєкт з environment: 'jsdom'.
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Покриття рахується лише для ядра — див. §11.3 docs/PROJECT.md.
      // Гонитва за 100% на IPC та UI породжує тести-пустушки.
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
