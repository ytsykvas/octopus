/**
 * Where each workspace's pull-request description stands, as main last said.
 *
 * One store for the window, as `backgroundTasks.ts` is, and for the same
 * reason: the PR tab reads the workspace on screen and the sidebar reads every
 * row, and the description has to outlive the pane that asked for it. Held in
 * a hook's state, it was dropped as soon as the user looked elsewhere.
 *
 * The bridge is taken when the first reader arrives and given back with the
 * last, and the list is read once on the way in: a push says everything about
 * one workspace, so it always wins over a list that was asked for earlier.
 */

import { useSyncExternalStore } from 'react'

import type { DraftEvent, DraftState } from '@core/pullRequestDraft.js'

let byWorkspace: ReadonlyMap<string, DraftState> = new Map()
const readers = new Set<() => void>()
let release: (() => void) | null = null
/**
 * Which taking of the bridge a list answers for. A list that lands after the
 * last reader has gone — or after StrictMode's second subscribe asked again —
 * would put back what belongs to nobody.
 */
let generation = 0

function store({ workspaceId, state }: DraftEvent): void {
  const next = new Map(byWorkspace)
  if (state === null) next.delete(workspaceId)
  else next.set(workspaceId, state)
  byWorkspace = next
  // Copied: a reader may leave mid-call.
  for (const reader of [...readers]) reader()
}

function subscribe(reader: () => void): () => void {
  readers.add(reader)

  if (release === null) {
    const taken = ++generation
    const pushed = new Set<string>()
    release = window.octopus.workspaces.onDraft((event) => {
      pushed.add(event.workspaceId)
      store(event)
    })

    void window.octopus.workspaces.drafts().then((result) => {
      if (taken !== generation || !result.ok) return
      for (const event of result.value) if (!pushed.has(event.workspaceId)) store(event)
    })
  }

  return () => {
    readers.delete(reader)
    if (readers.size > 0) return

    release?.()
    release = null
    generation++
    byWorkspace = new Map()
  }
}

/** A workspace's description: being written, written, refused, or none. */
export function useDraftState(workspaceId: string | null): DraftState | null {
  return useSyncExternalStore(subscribe, () =>
    workspaceId === null ? null : (byWorkspace.get(workspaceId) ?? null)
  )
}
