// Workspace ids recur: a removed workspace's name goes back to the pool and a
// project added again gets its old slug, so what is held per workspace is forgotten.
export type WorkspaceMatch = (workspaceId: string) => boolean

export interface ForgetsWorkspaces {
  readonly forget: (gone: WorkspaceMatch) => void
}

export function slotOf(workspaceId: string, tabKey: string): string {
  return `${workspaceId}#${tabKey}`
}

export function workspaceOfSlot(slot: string): string {
  return slot.slice(0, slot.lastIndexOf('#'))
}

export function withoutWorkspaces<V>(
  map: ReadonlyMap<string, V>,
  gone: WorkspaceMatch,
  workspaceOf: (key: string) => string = (key) => key
): ReadonlyMap<string, V> {
  const kept = [...map].filter(([key]) => !gone(workspaceOf(key)))
  return kept.length === map.size ? map : new Map(kept)
}

export function inProject(projectId: string): WorkspaceMatch {
  return (workspaceId) => workspaceId.startsWith(`${projectId}/`)
}
