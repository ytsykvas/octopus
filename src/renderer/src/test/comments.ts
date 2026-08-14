import { vi } from 'vitest'

import type { DiffCommentController } from '../hooks/useDiffComments.js'

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
