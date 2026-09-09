import type { WorkspaceView } from '@core/workspaces.js'

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
    writers: {},
    notes: '',
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
