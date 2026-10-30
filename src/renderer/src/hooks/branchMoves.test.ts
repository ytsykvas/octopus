import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspacePushedEvent } from '@core/service.js'

import { octopus } from '../test/octopus.js'
import { onBranchMoved } from './branchMoves.js'

/** Hands back whatever the module gave the bridge, so a test can drive it. */
function deliverer(): (event: WorkspacePushedEvent) => void {
  const last = vi.mocked(octopus().workspaces.onPushed).mock.calls.at(-1)
  if (!last) throw new Error('nothing subscribed to the bridge')
  return last[0]
}

const MOVED: WorkspacePushedEvent = {
  workspaceId: 'planner/anna',
  projectId: 'planner',
  head: 'a'.repeat(40)
}

let stop: () => void

beforeEach(() => {
  stop = vi.fn<() => void>()
  vi.mocked(octopus().workspaces.onPushed).mockReturnValue(stop)
})

describe('the window’s one subscription to branches moving', () => {
  // Every pull request pane and the workspace list listen; one `ipcRenderer`
  // listener each is how `chatEvents.ts` crossed Node's ceiling of ten.
  it('takes the bridge once however many are listening, and gives it back after the last', () => {
    const first = vi.fn()
    const second = vi.fn()
    const off = [onBranchMoved(first), onBranchMoved(second)]

    expect(octopus().workspaces.onPushed).toHaveBeenCalledTimes(1)

    deliverer()(MOVED)
    expect(first).toHaveBeenCalledWith(MOVED)
    expect(second).toHaveBeenCalledWith(MOVED)

    off[0]?.()
    expect(stop).not.toHaveBeenCalled()
    off[1]?.()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('does not skip a listener when another lets go from inside its own call', () => {
    const later = vi.fn()
    const off: (() => void)[] = []
    off.push(
      onBranchMoved(() => {
        off[0]?.()
      })
    )
    off.push(onBranchMoved(later))

    deliverer()(MOVED)

    expect(later).toHaveBeenCalledOnce()
    off[1]?.()
  })
})
