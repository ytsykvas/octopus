/**
 * Which workspace branch the remote just moved.
 *
 * The pull request pane could only learn of a push by asking GitHub, and it
 * asked on its own clock: a turn ending, a tab opened, fifteen seconds passing.
 * A push from the built-in terminal raised nothing at all. Every push this
 * checkout makes — the agent's, the terminal's, `gh pr create`'s — ends with git
 * rewriting `refs/remotes/<remote>/<branch>`, so that file changing is the one
 * signal all of them share.
 *
 * Watched in the **common** git dir, because a workspace is a worktree and its
 * remote-tracking refs live with the main checkout, not beside it.
 */

import { watch as watchFiles } from 'node:fs'
import { readFile as readText } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

/**
 * How long a burst of events is gathered into one read.
 *
 * git writes a lock, renames it over the ref and appends to the reflog; that is
 * several events for one change, and they land within a few milliseconds.
 */
export const REF_DEBOUNCE_MS = 200

/** A ref's content: a commit, SHA-1 or SHA-256. A symbolic ref is not one. */
const CommitSchema = z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/)

const LOCK = '.lock'

function withoutLock(path: string): string {
  return path.endsWith(LOCK) ? path.slice(0, -LOCK.length) : path
}

/**
 * The branch a path under `refs/` names on a remote, or null.
 *
 * Read through a `.lock`, which is often the only name an event carries. Null
 * for `HEAD`, which points at a branch rather than being one.
 */
export function parseRemoteRef(relative: string): string | null {
  const [root, remote, ...rest] = relative.split('/')
  if (root !== 'remotes' || remote === undefined || remote === '') return null

  const branch = withoutLock(rest.join('/'))

  return branch === '' || branch === 'HEAD' ? null : branch
}

/** What a watch needs of `fs.watch`'s answer, so a test can stand in for it. */
export interface RefWatcher {
  readonly close: () => void
  readonly on: (event: 'error', listener: (error: Error) => void) => unknown
}

export interface RemoteRefWatchDeps {
  /** The common git dir of a checkout, absolute. */
  readonly commonDirOf: (repoPath: string) => Promise<string>
  readonly onRef: (projectId: string, branch: string, head: string) => void
  readonly watch?: (
    path: string,
    options: { readonly recursive: boolean; readonly persistent: boolean },
    listener: (event: string, filename: string | null) => void
  ) => RefWatcher
  readonly readFile?: (path: string) => Promise<string>
  readonly debounceMs?: number
}

export interface RemoteRefWatch {
  /** Watches exactly these projects: starts the new, lets go of the gone. */
  readonly sync: (
    projects: readonly { readonly id: string; readonly repoPath: string }[]
  ) => Promise<void>
  readonly close: () => void
}

/** One project being watched: its watcher, its pending reads, what each ref last held. */
interface Watched {
  readonly watcher: RefWatcher
  readonly pending: Map<string, ReturnType<typeof setTimeout>>
  readonly seen: Map<string, string>
}

const defaultWatch: NonNullable<RemoteRefWatchDeps['watch']> = (path, options, listener) =>
  watchFiles(path, options, (event, filename) => {
    listener(event, filename)
  })

const defaultReadFile = (path: string): Promise<string> => readText(path, 'utf8')

export function createRemoteRefWatch(deps: RemoteRefWatchDeps): RemoteRefWatch {
  const watch = deps.watch ?? defaultWatch
  const readFile = deps.readFile ?? defaultReadFile
  const debounceMs = deps.debounceMs ?? REF_DEBOUNCE_MS

  const watched = new Map<string, Watched>()
  /** Projects whose git dir is being found, so an overlapping sync does not start them twice. */
  const starting = new Set<string>()
  /** The set the latest sync asked for — what a start finishing after an await checks against. */
  let wanted = new Set<string>()

  function stop(id: string): void {
    const one = watched.get(id)
    // A watcher that failed after it was let go of has nothing left to close.
    if (one === undefined) return

    watched.delete(id)
    for (const timer of one.pending.values()) clearTimeout(timer)
    one.watcher.close()
  }

  async function announce(
    id: string,
    refs: string,
    relative: string,
    branch: string,
    seen: Map<string, string>
  ): Promise<void> {
    let content: string
    try {
      content = await readFile(join(refs, relative))
    } catch {
      // Pruned, or renamed away between the event and the read: nothing moved
      // that anyone can be told about.
      return
    }

    // Let go of while the file was being read: a branch of a project nobody
    // has any more is not worth announcing.
    if (watched.get(id)?.seen !== seen) return

    const head = CommitSchema.safeParse(content.trim())
    if (!head.success) return

    // A fetch rewrites every ref it touches, moved or not.
    if (seen.get(branch) === head.data) return
    seen.set(branch, head.data)

    deps.onRef(id, branch, head.data)
  }

  async function start(id: string, repoPath: string): Promise<void> {
    starting.add(id)
    let common: string
    try {
      common = await deps.commonDirOf(repoPath)
    } catch {
      // An accelerator and nothing more: the pane reads on its own clock
      // without it. The next sync tries again.
      return
    } finally {
      starting.delete(id)
    }

    if (!wanted.has(id)) return

    const refs = join(common, 'refs')
    const pending = new Map<string, ReturnType<typeof setTimeout>>()
    const seen = new Map<string, string>()

    let watcher: RefWatcher
    try {
      watcher = watch(refs, { recursive: true, persistent: false }, (_event, filename) => {
        if (filename === null) return
        const branch = parseRemoteRef(filename)
        if (branch === null) return

        // Keyed by the ref rather than the name the event carried, so the lock
        // and the rename of one write are one read.
        const relative = withoutLock(filename)
        clearTimeout(pending.get(relative))
        pending.set(
          relative,
          setTimeout(() => {
            pending.delete(relative)
            void announce(id, refs, relative, branch, seen)
          }, debounceMs)
        )
      })
    } catch {
      // `refs/` gone, or not ours to read: as above, the pane does without.
      return
    }

    watcher.on('error', () => {
      stop(id)
    })
    watched.set(id, { watcher, pending, seen })
  }

  return {
    async sync(projects) {
      wanted = new Set(projects.map((project) => project.id))

      for (const id of [...watched.keys()]) if (!wanted.has(id)) stop(id)

      await Promise.all(
        projects
          .filter((project) => !watched.has(project.id) && !starting.has(project.id))
          .map((project) => start(project.id, project.repoPath))
      )
    },

    close() {
      wanted = new Set()
      for (const id of [...watched.keys()]) stop(id)
    }
  }
}
