import { defineConfig } from 'vitest/config'

import { alias, bootstrapOnly, testEnv, thresholds } from './vitest.shared.js'

/**
 * The headless half: core, main and preload.
 *
 * Kept in its own run rather than as a vitest project, because coverage is
 * merged across projects by file — a renderer file loaded in one project and
 * absent from the other came out as zero, and the merged report was wrong.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    environment: 'node',
    env: testEnv,
    include: ['src/{core,main,preload}/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/{core,main,preload}/**/*.ts'],
      exclude: bootstrapOnly,
      thresholds
    }
  }
})
