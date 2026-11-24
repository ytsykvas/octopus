import { basename } from 'node:path'

import { boardFolderName, isSkipped, sameName } from './boardNames.js'
import { ATTACHMENTS_DIR } from './boardSchema.js'
import { type RefWatcher, type RemoteRefWatchDeps, watchTree } from './remoteRefs.js'

export const BOARD_DEBOUNCE_MS = 300

export interface BoardWatchProject {
  readonly id: string
  readonly name: string
}

export interface BoardWatchDeps {
  readonly onChange: (projectId: string) => void
  readonly watch?: RemoteRefWatchDeps['watch']
  readonly debounceMs?: number
}

export interface BoardWatch {
  /** Watches this folder for these projects; the same folder again only takes the new list. */
  readonly sync: (folder: string, projects: readonly BoardWatchProject[]) => void
  readonly close: () => void
}

/** One recursive watcher for the whole board folder: FSEvents is recursive on macOS, and every project's folder is in it. */
export function createBoardWatch(deps: BoardWatchDeps): BoardWatch {
  const watch = deps.watch ?? watchTree
  const debounceMs = deps.debounceMs ?? BOARD_DEBOUNCE_MS
  let watched: { readonly folder: string; readonly watcher: RefWatcher } | null = null
  let projects: readonly BoardWatchProject[] = []
  const pending = new Map<string, ReturnType<typeof setTimeout>>()

  function stop(): void {
    for (const timer of pending.values()) clearTimeout(timer)
    pending.clear()
    watched?.watcher.close()
    watched = null
  }

  function schedule(id: string): void {
    clearTimeout(pending.get(id))
    pending.set(
      id,
      setTimeout(() => {
        pending.delete(id)
        deps.onChange(id)
      }, debounceMs)
    )
  }

  function listen(root: string, filename: string | null): void {
    // FSEvents names the watched folder itself by its own name, which a project may share:
    // like no name at all, any board may have changed.
    if (filename === null || filename === root) {
      for (const project of projects) schedule(project.id)
      return
    }
    // Our own `*.tmp`, `.DS_Store` inside a project: nothing a card is made of. A card's files are.
    // The project's folder itself is not judged so: `Release.tmp` is a name `boardFolderName` gives.
    const inside = filename.split('/').slice(1)
    if (inside.some((segment) => isSkipped(segment) && segment !== ATTACHMENTS_DIR)) return
    const top = filename.replace(/\/[\s\S]*$/, '')
    // Two projects whose names give one folder share it, so each is told.
    for (const project of projects) {
      if (sameName(boardFolderName(project.name), top)) schedule(project.id)
    }
  }

  return {
    sync(folder, next) {
      projects = next
      if (folder === watched?.folder) return
      stop()
      if (folder === '') return
      const root = basename(folder)
      let watcher: RefWatcher
      try {
        watcher = watch(folder, { recursive: true, persistent: false }, (_event, filename) => {
          listen(root, filename)
        })
      } catch {
        // Gone or not ours to read: the next sync — every read of the board — tries again.
        return
      }
      watcher.on('error', () => {
        // A watcher that failed after it was let go of has nothing left to close (as remoteRefs).
        if (watched?.watcher === watcher) stop()
      })
      watched = { folder, watcher }
    },
    close: stop
  }
}
