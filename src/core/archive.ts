/**
 * The script a workspace runs on its way out (§12.2).
 *
 * The build script gives a workspace things of its own — a database named after
 * it, a container, a directory. Nothing took them back: removing a workspace
 * removed its worktree and left the rest behind, so a project that made two
 * databases per workspace accumulated them for ever.
 *
 * It runs in the worktree while that still exists, with the same environment
 * the other scripts get. Which script it is, is `repoSource.ts`'s answer — it
 * may be a file the repository carries, or the project's own.
 */

import { spawn as spawnProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

import { isNotFound } from './persist.js'
import { present } from './present.js'
import type { ResolvedScript } from './repoSource.js'
import { scriptEnv, type ScriptValues } from './scriptEnv.js'
import { type Kill, killProcess, signalQuietly } from './signals.js'

/**
 * How long the script has.
 *
 * Dropping a database is seconds; anything past this is waiting on something
 * that will not arrive, and a workspace that cannot be removed is worse than
 * one that left something behind.
 *
 * Exported because Help's setup prompt tells the agent how long it has, and a
 * test holds the two to the same number.
 */
export const ARCHIVE_TIMEOUT_MS = 30_000

/** How much of stderr a failure reports: its end, which is where a script says what broke. */
export const ARCHIVE_OUTPUT_TAIL_BYTES = 64 * 1024

/** How long the group has between SIGTERM and SIGKILL once the deadline passes. */
export const ARCHIVE_KILL_GRACE_MS = 2_000

/** How long an exit waits for the rest of stderr, which a grandchild may hold open for ever. */
export const ARCHIVE_STDERR_DRAIN_MS = 200

/** How the script is run, injected so tests never spawn a shell. */
export type RunScript = (
  file: string,
  options: { cwd: string; env: Record<string, string>; timeout: number }
) => Promise<unknown>

/** What `spawnInGroup` reaches the system through, injected so a test can stand in. */
export interface SpawnInGroupDeps {
  readonly spawn?: typeof spawnProcess
  readonly kill?: Kill
  readonly graceMs?: number
  readonly drainMs?: number
}

/**
 * Runs the script as the leader of a process group of its own, and waits for it.
 *
 * Not `execFile`: its 1 MiB output ceiling fails a noisy cleanup that succeeded
 * (`docker compose down -v`, `rm -rv`), its deadline signals the script alone and
 * leaves the `psql` or `docker` it started under init, and a missing cwd surfaces
 * as `spawn archive.sh ENOENT`, blaming the script. So stdout goes to /dev/null and
 * only the tail of stderr is kept; the script leads a group of its own (`detached`),
 * signalled as `-pid`, SIGTERM then SIGKILL, as `src/main/terminals.ts` stops a
 * server; and the directory is looked at first.
 *
 * Done at `exit`, not `close`, since a grandchild left in the background holds the
 * pipe open — then the rest of stderr is read, for at most `ARCHIVE_STDERR_DRAIN_MS`.
 */
export async function spawnInGroup(
  file: string,
  options: { cwd: string; env: Record<string, string>; timeout: number },
  deps: SpawnInGroupDeps = {}
): Promise<void> {
  const spawn = deps.spawn ?? spawnProcess
  const kill = deps.kill ?? killProcess
  const graceMs = deps.graceMs ?? ARCHIVE_KILL_GRACE_MS
  const drainMs = deps.drainMs ?? ARCHIVE_STDERR_DRAIN_MS

  try {
    await stat(options.cwd)
  } catch (error) {
    if (!isNotFound(error)) throw error
    throw new Error(
      `The workspace directory ${options.cwd} was already gone, so ${basename(file)} did not run.`,
      { cause: error }
    )
  }

  const child = spawn(file, [], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe']
  })

  const stderr = present(child.stderr, 'the stderr pipe the spawn was given')

  return new Promise((resolve, reject) => {
    let tail = Buffer.alloc(0)
    let timedOut = false
    let settled = false

    const signalGroup = (signal: NodeJS.Signals): void => {
      signalQuietly(kill, -present(child.pid, 'the pid of a script that spawned'), signal)
    }

    const deadline = setTimeout(() => {
      timedOut = true
      signalGroup('SIGTERM')
      // Not cleared on exit: the script usually dies of SIGTERM at once, and what it
      // started that ignores SIGTERM still has the SIGKILL coming.
      setTimeout(() => {
        signalGroup('SIGKILL')
      }, graceMs).unref()
    }, options.timeout)

    stderr.on('data', (chunk: Buffer) => {
      tail = Buffer.concat([tail, chunk])
      if (tail.length > ARCHIVE_OUTPUT_TAIL_BYTES) tail = tail.subarray(-ARCHIVE_OUTPUT_TAIL_BYTES)
    })

    const settle = (error: Error | null): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      stderr.destroy()
      if (error === null) resolve()
      else reject(error)
    }

    child.on('error', settle)
    child.on('exit', (code) => {
      // Exited before the deadline is in time, however long stderr then takes.
      clearTimeout(deadline)
      const finish = (): void => {
        if (code === 0 && !timedOut) {
          settle(null)
          return
        }
        const reason = timedOut ? ` (timed out after ${String(options.timeout / 1000)} s)` : ''
        settle(new Error(`Command failed: ${file}${reason}\n${tail.toString('utf8').trimEnd()}`))
      }

      if (stderr.readableEnded || stderr.destroyed) {
        finish()
        return
      }
      const drained = setTimeout(finish, drainMs)
      stderr.once('end', () => {
        clearTimeout(drained)
        finish()
      })
    })
  })
}

/** What the script needs to know about the workspace it is taking apart. */
export interface ArchiveValues extends ScriptValues {
  readonly path: string
  /** The variables of the set in effect at removal — the only one there is by then. */
  readonly variables: Readonly<Record<string, string>>
}

/**
 * What became of the cleanup, for the window to say once the workspace has gone.
 *
 * Nothing here stops a removal, which made every failure silent: a script that
 * failed, or a repository's script skipped as unapproved, left a database
 * behind and nobody found out.
 */
export type CleanupOutcome =
  | { readonly status: 'done' }
  | { readonly status: 'none' }
  | { readonly status: 'unapproved' }
  | { readonly status: 'unreadable'; readonly detail: string }
  | { readonly status: 'failed'; readonly detail: string }

/** A workspace whose cleanup did not take back what it gave, by name. */
export interface LeftBehind {
  readonly workspace: string
  readonly cleanup: CleanupOutcome
}

/** Whether a cleanup leaves something to report: it failed, or never ran. */
export function leavesBehind(cleanup: CleanupOutcome): boolean {
  return cleanup.status !== 'done' && cleanup.status !== 'none'
}

/**
 * Runs a workspace's cleanup script, if it has one.
 *
 * **Nothing here can stop the removal.** A script that fails, hangs or was
 * never written all end the same way: the workspace goes. That is deliberate
 * — a workspace you cannot delete because a cleanup script is broken is a
 * worse problem than the one being cleaned up.
 *
 * Answers with what went wrong, for a caller that wants to say so, or null.
 */
export async function runArchiveScript(
  script: ResolvedScript | null,
  values: ArchiveValues,
  runner: RunScript = spawnInGroup
): Promise<string | null> {
  if (script === null) return null

  try {
    // Executed directly, so the file's own executable bit applies. PATH is
    // already the login shell's by then (`src/main/loginPath.ts`), so `dropdb`
    // and `kubectl` resolve the way they do in a terminal.
    await runner(script.path, {
      cwd: values.path,
      // Ours last, so a set that names `OCTOPUS_ROOT_PATH` cannot point the
      // cleanup at somebody else's checkout.
      env: { ...values.variables, ...scriptEnv('archive', values) },
      timeout: ARCHIVE_TIMEOUT_MS
    })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
