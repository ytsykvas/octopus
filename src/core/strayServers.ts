/**
 * Servers running in a workspace that octopus did not start.
 *
 * The agent may start a dev server of its own — to look at a page, to try a
 * change — and nothing makes it stop one. Left running, it outlives the turn and
 * blocks the workspace's Run: Rails keeps one pidfile per checkout and refuses
 * to boot while it names a live process, whatever port either copy is on. Stop
 * cannot reach it either, since Stop ends the terminal octopus opened and this
 * was never in one.
 *
 * So a run asks first. What counts is a process **listening on a TCP port**
 * whose working directory is the worktree or below it: a server, as opposed to
 * the shells, editors and agent sessions that sit in the same directory and
 * listen on nothing. It is asked only while nothing of ours is alive there —
 * the moment the port is settled — so anything found belongs to somebody else.
 */

import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { sep } from 'node:path'
import { promisify } from 'node:util'

import { z } from 'zod'

import { CodedError } from './codedError.js'

const run = promisify(execFile)

export interface StrayServer {
  readonly pid: number
  /** What `lsof` calls it — the executable's name, which is what a person recognises. */
  readonly command: string
  readonly ports: readonly number[]
}

/**
 * The pids the window asks to have stopped, as they cross the bridge.
 *
 * Checked again against the machine before anything is signalled; this only
 * keeps a malformed list from getting that far.
 */
export const StrayPidsSchema = z.array(z.number().int().positive()).max(256)

export type StrayErrorCode = 'strayStopFailed'

export class StrayError extends CodedError<StrayErrorCode> {
  override readonly name = 'StrayError'
}

/** Runs `lsof` with these arguments and answers with what it printed. */
export type Lsof = (args: readonly string[]) => Promise<string>

/** How a signal is sent — `process.kill`'s shape, injected so a test kills nothing. */
export type Kill = (pid: number, signal: NodeJS.Signals) => void

export interface StrayDeps {
  readonly lsof: Lsof
  readonly kill: Kill
  readonly sleep: (ms: number) => Promise<void>
}

/**
 * How long a server is given to go after each signal.
 *
 * Puma on `SIGTERM` finishes the requests it holds and takes its job workers
 * down with it, which is seconds rather than milliseconds; `SIGKILL` is the
 * kernel's and needs only long enough for the socket to close.
 */
const TERM_GRACE_MS = 5_000
const KILL_GRACE_MS = 2_000
const POLL_MS = 250

/**
 * The real `lsof`.
 *
 * It exits 1 whenever any part of the question found nothing — no socket
 * listening, or one of several pids already gone — and still prints what it
 * did find. That is an answer, not a failure, so the output is kept; anything
 * else still throws.
 */
export function lsofVia(
  exec: (file: string, args: string[], options: { timeout: number }) => Promise<{ stdout: string }>
): Lsof {
  return async (args) => {
    try {
      const { stdout } = await exec('lsof', [...args], { timeout: 5_000 })
      return stdout
    } catch (error: unknown) {
      if (exitedWithOne(error)) return error.stdout
      throw error
    }
  }
}

export const runLsof: Lsof = lsofVia(run)

function exitedWithOne(error: unknown): error is { stdout: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 1 &&
    'stdout' in error &&
    typeof error.stdout === 'string'
  )
}

interface LsofProcess {
  readonly pid: number
  readonly command: string
  readonly names: readonly string[]
}

/**
 * `lsof -F` output, one record per process.
 *
 * Each line is a field letter and its value: `p` opens a process, `c` is its
 * command and every `n` a file it holds. The `f` lines `lsof` adds whatever was
 * asked for are of no use here and skipped with anything else unrecognised.
 */
export function parseLsof(output: string): LsofProcess[] {
  const processes: { pid: number; command: string; names: string[] }[] = []

  for (const line of output.split('\n')) {
    const value = line.slice(1)

    if (line.startsWith('p')) {
      processes.push({ pid: Number(value), command: '', names: [] })
      continue
    }

    const current = processes.at(-1)
    if (current === undefined) continue

    if (line.startsWith('c')) current.command = value
    else if (line.startsWith('n')) current.names.push(value)
  }

  return processes
}

/**
 * The port a listening socket's name ends in — `*:3000`, `127.0.0.1:3000` and
 * `[::1]:3000` alike, which is why it is read from the last colon.
 */
function portOf(name: string): number | null {
  const port = Number(name.slice(name.lastIndexOf(':') + 1))
  return Number.isInteger(port) && port > 0 ? port : null
}

/**
 * Whether `path` is `root` or below it.
 *
 * By whole segments: a sibling workspace whose name starts with this one's —
 * `kyiv2` beside `kyiv` — is not inside it.
 */
function within(root: string, path: string | undefined): boolean {
  return path !== undefined && (path === root || path.startsWith(root + sep))
}

export async function findStrayServers(
  worktree: string,
  lsof: Lsof = runLsof
): Promise<StrayServer[]> {
  const listening = parseLsof(await lsof(['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']))
  if (listening.length === 0) return []

  const cwds = new Map(
    parseLsof(
      await lsof(['-a', '-d', 'cwd', '-p', listening.map((item) => item.pid).join(','), '-Fpn'])
    ).map((item) => [item.pid, item.names[0]])
  )

  // `lsof` reports the kernel's path, so the worktree is resolved to match it:
  // under a temporary directory on macOS that is `/private/var`, not `/var`.
  const root = await realpath(worktree)

  return listening
    .filter((item) => within(root, cwds.get(item.pid)))
    .map((item) => ({
      pid: item.pid,
      command: item.command,
      // A socket per address family, so the same port twice is ordinary.
      ports: [...new Set(item.names.flatMap((name) => portOf(name) ?? []))]
    }))
}

/**
 * Stops the servers the user agreed to stop, and only those.
 *
 * The list is asked for again first: the user read the earlier one in a dialog,
 * and in the meantime a server may have exited and its pid gone to something
 * else. Only a pid still serving from this worktree is signalled.
 *
 * The listening process is signalled, not its group. A server the agent started
 * shares a group with the shell the agent ran it in, and a framework that has
 * children of its own — Puma's job workers — takes them down itself.
 *
 * "Gone" means no longer serving from here, which is also what Run needs. A
 * pid that is still alive would not do as the test: a child its parent has not
 * reaped yet answers a signal while holding nothing.
 */
export async function stopStrayServers(
  worktree: string,
  pids: readonly number[],
  deps: StrayDeps
): Promise<void> {
  const serving = async (among: readonly number[]): Promise<number[]> =>
    (await findStrayServers(worktree, deps.lsof))
      .map((server) => server.pid)
      .filter((pid) => among.includes(pid))

  const settle = async (among: readonly number[], graceMs: number): Promise<number[]> => {
    if (among.length === 0) return []

    let left = await serving(among)
    for (let waited = 0; left.length > 0 && waited < graceMs; waited += POLL_MS) {
      await deps.sleep(POLL_MS)
      left = await serving(left)
    }
    return left
  }

  const signal = (targets: readonly number[], name: NodeJS.Signals): void => {
    for (const pid of targets) {
      try {
        deps.kill(pid, name)
      } catch {
        // Exited between the question and the signal, which is what was wanted.
      }
    }
  }

  const targets = await serving(pids)
  signal(targets, 'SIGTERM')

  const stubborn = await settle(targets, TERM_GRACE_MS)
  signal(stubborn, 'SIGKILL')

  const [survivor] = await settle(stubborn, KILL_GRACE_MS)
  if (survivor !== undefined) {
    throw new StrayError(
      'strayStopFailed',
      { pid: String(survivor) },
      `process ${String(survivor)} is still serving from ${worktree}`
    )
  }
}

export const defaultStrayDeps: StrayDeps = {
  lsof: runLsof,
  kill: (pid, signal) => {
    process.kill(pid, signal)
  },
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
}
