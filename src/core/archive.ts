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

/** How the script is run, injected so tests never spawn a shell. */
export type RunScript = (
  file: string,
  options: { cwd: string; env: Record<string, string>; timeout: number }
) => Promise<unknown>

/** What `spawnInGroup` reaches the system through, injected so a test can stand in. */
export interface SpawnInGroupDeps {
  readonly spawn?: typeof spawnProcess
  readonly kill?: (pid: number, signal?: string | number) => true
  readonly graceMs?: number
}

/**
 * Runs the script as the leader of a process group of its own, and waits for it.
 *
 * Not `execFile`, for three reasons. Its 1 MiB output ceiling killed a cleanup that
 * succeeded noisily — `docker compose down -v`, `rm -rv` — and reported it failed;
 * here stdout goes to /dev/null, since nobody shows a success, and only the end of
 * stderr is kept for a failure. Its deadline signalled the script alone, and the
 * `psql` or `docker` it had started went on under init; here `detached` makes the
 * script a group leader and the deadline signals the group (`-pid`), SIGTERM then
 * SIGKILL, as `src/main/terminals.ts` stops a server. And a workspace directory
 * already deleted by hand surfaced as `spawn archive.sh ENOENT`, blaming the script;
 * here the directory is looked at first and named.
 *
 * Done at `exit`, not `close`: a grandchild left running in the background holds
 * the pipe open, and the removal must not wait on it.
 */
export async function spawnInGroup(
  file: string,
  options: { cwd: string; env: Record<string, string>; timeout: number },
  deps: SpawnInGroupDeps = {}
): Promise<void> {
  const spawn = deps.spawn ?? spawnProcess
  const kill = deps.kill ?? ((pid: number, signal?: string | number) => process.kill(pid, signal))
  const graceMs = deps.graceMs ?? ARCHIVE_KILL_GRACE_MS

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

  // Asked for as a pipe two lines up, so it is there.
  const stderr = present(child.stderr, 'the stderr pipe the spawn was given')

  return new Promise((resolve, reject) => {
    let tail = Buffer.alloc(0)
    let timedOut = false
    let settled = false

    const signalGroup = (signal: NodeJS.Signals): void => {
      try {
        kill(-present(child.pid, 'the pid of a script that spawned'), signal)
      } catch {
        // The group has already gone, which is what the signal was for.
      }
    }

    const deadline = setTimeout(() => {
      timedOut = true
      signalGroup('SIGTERM')
      // Never cleared: see `settle`.
      setTimeout(() => {
        signalGroup('SIGKILL')
      }, graceMs)
    }, options.timeout)

    stderr.on('data', (chunk: Buffer) => {
      tail = Buffer.concat([tail, chunk])
      if (tail.length > ARCHIVE_OUTPUT_TAIL_BYTES) tail = tail.subarray(-ARCHIVE_OUTPUT_TAIL_BYTES)
    })

    const settle = (error: Error | null): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      // The SIGKILL is not called off: past the deadline the script usually dies of
      // SIGTERM at once, and what it started that ignores SIGTERM still has it coming.
      stderr.destroy()
      if (error === null) resolve()
      else reject(error)
    }

    child.on('error', settle)
    child.on('exit', (code) => {
      if (code === 0 && !timedOut) {
        settle(null)
        return
      }
      const reason = timedOut ? ` (timed out after ${String(options.timeout / 1000)} s)` : ''
      settle(new Error(`Command failed: ${file}${reason}\n${tail.toString('utf8').trimEnd()}`))
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
