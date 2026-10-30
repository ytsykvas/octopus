import { act } from '@testing-library/react'
import { vi } from 'vitest'

import type { WorkspaceView } from '@core/workspaces.js'

import { refuseSilence } from './chat.js'
import { octopus } from './octopus.js'

/**
 * A workspace as the panels receive it.
 *
 * Named after its workspace so the directory a terminal opens in identifies
 * which workspace it belongs to.
 */
export function workspaceView(name: string, overrides: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    id: `planner/${name}`,
    projectId: 'planner',
    name,
    branch: `ytsykvas/${name}`,
    path: `/tmp/planner/${name}`,
    status: 'idle',
    port: 3100,
    createdAt: '2026-08-08T00:00:00.000Z',
    branchSince: null,
    writers: {},
    notes: '',
    envFileApplied: null,
    ownerId: null,
    envProfile: null,
    chats: [],
    changedFiles: 0,
    ahead: 0,
    missing: false,
    headOnBranch: true,
    ...overrides
  }
}

/**
 * Says a workspace's branch moved on the remote, as main would after a git
 * write to `refs/remotes/`, to whatever subscribed.
 */
export function emitBranchMoved(workspaceId: string, head: string, projectId = 'planner'): void {
  const handlers = vi.mocked(octopus().workspaces.onPushed).mock.calls.map(([handler]) => handler)
  refuseSilence(handlers.length, 'workspaces.onPushed')

  act(() => {
    for (const handler of handlers) handler({ workspaceId, projectId, head })
  })
}
