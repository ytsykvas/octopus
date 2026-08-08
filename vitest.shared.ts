import { resolve } from 'node:path'

export const alias = {
  '@core': resolve('src/core'),
  '@renderer': resolve('src/renderer/src')
}

/**
 * Files with nothing to test: bootstrap that mounts a framework, and a
 * type-only module. Everything else is held to the threshold.
 */
export const bootstrapOnly = [
  'src/**/*.{test,spec}.{ts,tsx}',
  'src/core/types.ts',
  'src/renderer/src/env.d.ts',
  'src/renderer/src/main.tsx',
  'src/main/index.ts',
  'src/renderer/src/test/**'
]

export const thresholds = {
  statements: 100,
  branches: 100,
  functions: 100,
  lines: 100
}
