import { vi } from 'vitest'

import type { DiffCommentController } from '../hooks/useDiffComments.js'
import type { PullRequestQuoteController } from '../hooks/usePullRequestQuotes.js'

/**
 * A controller holding whatever a test says it holds.
 *
 * The real one lives in `App`, so every pane that takes it needs a stand-in —
 * and most of them are not about the notes at all.
 */
export function commentController(
  overrides: Partial<DiffCommentController> = {}
): DiffCommentController {
  return { pending: [], add: vi.fn(), remove: vi.fn(), clear: vi.fn(), ...overrides }
}

/**
 * The same, for the remarks carried in from a review.
 *
 * A second store rather than one holding both kinds, which is what keeps the
 * diff pane narrowing a shape whose every member it can hold — so there are two
 * of these, beside each other.
 */
export function quoteController(
  overrides: Partial<PullRequestQuoteController> = {}
): PullRequestQuoteController {
  return { pending: [], add: vi.fn(), remove: vi.fn(), clear: vi.fn(), ...overrides }
}
