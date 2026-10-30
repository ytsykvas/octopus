/**
 * One subscription to workspace branches moving on the remote, shared by
 * everything that wants them.
 *
 * The same reason as `chatEvents.ts`: the bridge registers a fresh
 * `ipcRenderer.on` per call, and every pull request pane and the workspace list
 * listen. Taken when the first listener arrives and given back when the last
 * one goes.
 */

import type { WorkspacePushedEvent } from '@core/service.js'

type Handler = (event: WorkspacePushedEvent) => void

const handlers = new Set<Handler>()

/** How to let go of the bridge, or null while nobody is listening. */
let release: (() => void) | null = null

function deliver(event: WorkspacePushedEvent): void {
  // Copied before the walk: a handler may unsubscribe from inside its own call,
  // and a set edited mid-iteration would skip whichever came next.
  for (const handler of [...handlers]) handler(event)
}

/** Listens to every workspace's branch moving; the caller filters. */
export function onBranchMoved(handler: Handler): () => void {
  handlers.add(handler)
  release ??= window.octopus.workspaces.onPushed(deliver)

  return () => {
    handlers.delete(handler)
    if (handlers.size > 0) return

    release?.()
    release = null
  }
}
