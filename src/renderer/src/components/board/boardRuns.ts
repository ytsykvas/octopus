import type { BoardCard, CardRunEntry } from '@core/boardSchema.js'
import type { WorkspaceView } from '@core/workspaces.js'

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
