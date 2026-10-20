import { type BranchRequest, pullRequestStanding, type Standing } from '@core/pullRequestShapes.js'
import type { ResourceKind, ResourceReading, Usage } from '@core/resources.js'
import type { WorkspaceView } from '@core/workspaces.js'

/**
 * What the status bar counts, worked out from what the window already holds.
 *
 * Kept apart from the component so each count is a function of its inputs and
 * nothing else: a figure in the corner of every screen that is wrong is worse
 * than no figure, and here it can be checked without rendering anything.
 */

/** A workspace whose agent is in one state, and the conversation to open for it. */
export interface AgentItem {
  readonly workspace: WorkspaceView
  /** The conversation in that state, so opening the row lands on it. */
  readonly chatId: string | null
}

/**
 * Every workspace in one agent state, across every project.
 *
 * By the workspace's own status, which the core already summarises from its
 * conversations — waiting outranks working there, so one workspace is never
 * counted under both.
 */
export function agentsIn(
  workspaces: readonly WorkspaceView[],
  status: 'running' | 'waiting_permission'
): AgentItem[] {
  return workspaces
    .filter((workspace) => workspace.status === status)
    .map((workspace) => ({
      workspace,
      chatId: workspace.chats.find((chat) => chat.status === status)?.id ?? null
    }))
}

/** An open pull request of one of our workspaces, and where it stands. */
export interface RequestItem {
  readonly workspace: WorkspaceView
  readonly request: BranchRequest
  readonly standing: Standing
}

/**
 * The open requests whose branch belongs to one of our workspaces.
 *
 * A repository's list holds everybody's requests; the bar is about the work
 * done here, so a request counts only when a workspace stands on its branch.
 */
export function openRequests(
  workspaces: readonly WorkspaceView[],
  byProject: ReadonlyMap<string, ReadonlyMap<string, BranchRequest>>
): RequestItem[] {
  return workspaces.flatMap((workspace) => {
    const request = byProject.get(workspace.projectId)?.get(workspace.branch)
    if (request?.state !== 'open') return []
    return [{ workspace, request, standing: pullRequestStanding(request) }]
  })
}

/** One workspace's share of the machine, and what inside it is spending it. */
export interface WorkspaceUsage extends Usage {
  readonly workspaceId: string
  readonly kinds: readonly { readonly kind: ResourceKind; readonly memory: number }[]
}

/**
 * The reading per workspace, heaviest first.
 *
 * By memory, because that is what runs out: a busy CPU comes and goes with a
 * turn, while a dev server forgotten in a workspace nobody has opened for a
 * day holds its memory the whole time.
 */
export function usageByWorkspace(reading: ResourceReading): WorkspaceUsage[] {
  const grouped = new Map<string, { cpu: number; memory: number; kinds: WorkspaceUsage['kinds'] }>()

  for (const part of reading.parts) {
    const current = grouped.get(part.workspaceId) ?? { cpu: 0, memory: 0, kinds: [] }
    grouped.set(part.workspaceId, {
      cpu: current.cpu + part.cpu,
      memory: current.memory + part.memory,
      kinds: [...current.kinds, { kind: part.kind, memory: part.memory }]
    })
  }

  return [...grouped]
    .map(([workspaceId, usage]) => ({ workspaceId, ...usage }))
    .sort((left, right) => right.memory - left.memory)
}
