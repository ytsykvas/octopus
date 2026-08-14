/**
 * What the diff does when the highlighter cannot help.
 *
 * In its own file because the highlighter is built once per module instance:
 * a construction that fails has to be the first thing this module is asked to
 * do, and a test alongside the working ones would be answered by the
 * highlighter they already built.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('shiki/core', () => ({
  createHighlighterCore: () => Promise.reject(new Error('no highlighter here'))
}))

const { highlight } = await import('./highlight.js')

describe('highlight, when the highlighter will not start', () => {
  // A missing courtesy, not a failure worth taking the diff down for.
  it('answers with no colours rather than throwing', async () => {
    await expect(highlight('typescript', 'const x = 1')).resolves.toBeNull()
  })
})
