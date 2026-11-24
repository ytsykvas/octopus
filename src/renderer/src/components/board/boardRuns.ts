import type { BoardCard, CardRunEntry } from '@core/boardSchema.js'
import type { BranchRequest } from '@core/pullRequestShapes.js'
import type { WorkspaceView } from '@core/workspaces.js'

export type CardMark =
  | {
      readonly kind: 'live'
      readonly workspace: WorkspaceView
      readonly request: BranchRequest | null
    }
  | { readonly kind: 'elsewhere'; readonly machine: string }
  | { readonly kind: 'merged' }
  | { readonly kind: 'removed' }

export function linkedByCard(
  workspaces: readonly WorkspaceView[]
): ReadonlyMap<string, WorkspaceView> {
  return new Map(
    workspaces.flatMap((workspace) =>
      workspace.card === null ? [] : [[workspace.card, workspace] as const]
    )
  )
}

export function linkedTo(
  card: BoardCard,
  linkedBy: ReadonlyMap<string, WorkspaceView>
): WorkspaceView | null {
  return card.meta.id === undefined ? null : (linkedBy.get(card.meta.id) ?? null)
}

// By `device`, never the hostname: that changes with the network and can repeat between Macs.
export function openRunElsewhere(
  runs: readonly CardRunEntry[],
  deviceId: string
): CardRunEntry | undefined {
  return runs.findLast((run) => run.ended === undefined && run.device !== deviceId)
}

// By `started`, not file order: a run whose first write failed is appended after later ones.
export function newestFirst(runs: readonly CardRunEntry[]): CardRunEntry[] {
  return [...runs].sort((a, b) => Date.parse(b.started) - Date.parse(a.started))
}

export function cardMark(
  card: BoardCard,
  linkedBy: ReadonlyMap<string, WorkspaceView>,
  requests: ReadonlyMap<string, BranchRequest>,
  deviceId: string
): CardMark | null {
  const workspace = linkedTo(card, linkedBy)
  if (workspace !== null) {
    return { kind: 'live', workspace, request: requests.get(workspace.branch) ?? null }
  }
  // Any open run of another installation, not only the last: two Macs may each have started it.
  const elsewhere = openRunElsewhere(card.meta.runs, deviceId)
  if (elsewhere !== undefined) return { kind: 'elsewhere', machine: elsewhere.machine }
  const [last] = newestFirst(card.meta.runs)
  if (last === undefined) return null
  if (last.merged !== undefined) return { kind: 'merged' }
  // Also a run this Mac left open with no workspace here: its summary was lost at the removal.
  return { kind: 'removed' }
}

export type RunState = 'merged' | 'removed' | 'open'

export function runState(
  run: CardRunEntry,
  deviceId: string,
  linked: WorkspaceView | null
): RunState {
  if (run.merged !== undefined) return 'merged'
  if (run.ended !== undefined) return 'removed'
  if (run.device !== deviceId) return 'open'
  // A run of this installation is in work only while its workspace is here: a run's
  // `started` is its workspace's `createdAt`. Otherwise the removal lost its summary.
  return linked?.createdAt === run.started ? 'open' : 'removed'
}
