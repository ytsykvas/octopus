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

  function listen(_event: string, filename: string | null): void {
    if (filename === null) {
      for (const project of projects) schedule(project.id)
      return
    }
    // Our own `*.tmp`, `.DS_Store`: nothing a card is made of. A card's files are.
    if (filename.split('/').some((segment) => isSkipped(segment) && segment !== ATTACHMENTS_DIR))
      return
    const top = filename.replace(/\/[\s\S]*$/, '')
    const project = projects.find((candidate) => sameName(boardFolderName(candidate.name), top))
    if (project !== undefined) schedule(project.id)
  }

  return {
    sync(folder, next) {
      projects = next
      if (folder === watched?.folder) return
      stop()
      if (folder === '') return
      let watcher: RefWatcher
      try {
        watcher = watch(folder, { recursive: true, persistent: false }, listen)
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
