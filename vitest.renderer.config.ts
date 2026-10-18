import { defineConfig } from 'vitest/config'

import { alias, bootstrapOnly, testEnv, thresholds } from './vitest.shared.js'

/** The interface, in a DOM. */
export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    environment: 'jsdom',
    env: testEnv,
    // `test:race` puts the scheduler at a disadvantage first; see `schedulerLoses.ts`.
    setupFiles: [
      ...(process.env.OCTOPUS_SCHEDULER_LOSES === '1'
        ? ['src/renderer/src/test/schedulerLoses.ts']
        : []),
      'src/renderer/src/test/setup.ts'
    ],
    include: ['src/renderer/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/renderer/**/*.{ts,tsx}'],
      exclude: bootstrapOnly,
      thresholds
    }
  }
})
