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

/**
 * The zone both runs read the clock in.
 *
 * The composer's attic prints a wall clock, so an unpinned suite would be
 * asserting a fact about the machine that ran it.
 *
 * Deliberately not UTC. A formatter that reached for `getUTCHours` would pass
 * every expectation under UTC and be wrong for every reader — green, and
 * describing what the code does rather than what it is for. Kyiv is three hours
 * off in summer and two in winter, so local and UTC cannot agree by accident,
 * and a fixture written in August is not the same arithmetic as one in December.
 */
export const testEnv = { TZ: 'Europe/Kyiv' }

export const thresholds = {
  statements: 100,
  branches: 100,
  functions: 100,
  lines: 100
}
