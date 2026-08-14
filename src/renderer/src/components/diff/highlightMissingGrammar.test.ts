/**
 * What the diff does when a grammar will not load.
 *
 * In its own file for the same reason as the failing highlighter beside it:
 * the loaded grammars are remembered per module instance, so a language that
 * fails has to be one this instance has not already been given.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('./grammars.js', () => ({
  GRAMMARS: { typescript: () => Promise.reject(new Error('chunk missing')) }
}))

const { highlight } = await import('./highlight.js')

describe('highlight, when a grammar will not load', () => {
  // A file drawn plain reads perfectly well; a pane that threw would not.
  it('answers with no colours rather than throwing', async () => {
    await expect(highlight('typescript', 'const x = 1')).resolves.toBeNull()
  })
})
