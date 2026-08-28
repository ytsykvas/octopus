import type { MergeMethod } from '@core/pullRequests.js'

/**
 * How a request can be landed, in the order the menu offers them.
 *
 * Shared rather than declared twice: the pane and the header both merge, and
 * two lists would be two places for the choice to drift apart. The keys are
 * literals so `t()` still checks them.
 */
export const MERGE_METHODS: readonly {
  readonly method: MergeMethod
  readonly labelKey:
    'pullRequest.methodMerge' | 'pullRequest.methodSquash' | 'pullRequest.methodRebase'
}[] = [
  { method: 'merge', labelKey: 'pullRequest.methodMerge' },
  { method: 'squash', labelKey: 'pullRequest.methodSquash' },
  { method: 'rebase', labelKey: 'pullRequest.methodRebase' }
]
