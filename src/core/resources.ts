/**
 * What the application costs the machine, and which workspace is spending it.
 *
 * The figure that matters is the whole tree under the main process, not the
 * main process itself: Electron is the cheap part, and the memory goes to the
 * agents, the dev servers and the shells every workspace starts. So the reading
 * is one `ps` over every process, walked down from the main pid, and each
 * subtree is charged to the workspace that owns its root.
 *
 * Ownership comes from two places. A terminal's pty is spawned by `main/`,
 * which keeps the pid beside the workspace that asked for it. An agent is
 * spawned by the SDK, which exposes no pid at all — but it runs in its
 * workspace's worktree, so a direct child of the main process whose working
 * directory is inside a workspace is that workspace's agent. One `lsof` reads
 * every candidate's directory at once, and replacing the SDK's own spawn to
 * learn a number it already knows was the costlier way to the same answer.
 *
 * Whatever no workspace claims is the application itself, so the total is
 * right even when attribution is not.
 *
 * `ps` counts CPU per core, so a busy tree on a ten-core machine read 153%
 * and nobody could tell how much of the machine that was. The reading divides
 * by the core count, and 100% is the whole processor.
 */

import { execFile } from 'node:child_process'
import { sep } from 'node:path'

import { z } from 'zod'

import type { TerminalOwner } from './terminal.js'

/** What a workspace's process is, in the words the breakdown uses. */
export type ResourceKind = 'agent' | 'terminal' | 'server'

/** One line of the process table. */
export interface ProcessRow {
  readonly pid: number
  readonly ppid: number
  /** Percent of one core, as `ps` prints it; a reading divides it by the core count. */
  readonly cpu: number
  /** Resident memory in bytes. */
  readonly memory: number
}

/** A process whose subtree belongs to one workspace. */
export interface ResourceOwner {
  readonly pid: number
  readonly workspaceId: string
  readonly kind: ResourceKind
}

export interface Usage {
  /** Percent of the whole processor, every core together. */
  readonly cpu: number
  readonly memory: number
}

/** One workspace's share of one kind. */
export interface ResourcePart extends Usage {
  readonly workspaceId: string
  readonly kind: ResourceKind
}

export interface ResourceReading {
  readonly total: Usage
  /** The application itself, and anything no workspace claims. */
  readonly app: Usage
  readonly parts: readonly ResourcePart[]
}

/** Where a workspace lives, which is what an agent's working directory is matched against. */
export interface WorkspacePlace {
  readonly id: string
  readonly path: string
}

/**
 * Runs an external command and answers its output.
 *
 * A parameter so the reading can be tested without a process table.
 */
export type ProcessExec = (command: string, args: readonly string[]) => Promise<string>

/**
 * `execFile`, keeping the output of a command that failed after printing it.
 *
 * `lsof` exits 1 when any one of the pids it was given has ended between the
 * `ps` and the question — an ordinary race for a short-lived process — and
 * still prints the rest. Throwing those away would lose every agent's
 * attribution to one shell that had just finished.
 */
export const defaultProcessExec: ProcessExec = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, [...args], { timeout: 5_000 }, (error, stdout) => {
      if (error !== null && stdout === '') reject(new Error(error.message, { cause: error }))
      else resolve(stdout)
    })
  })

const RowSchema = z.tuple([
  z.number().int().positive(),
  z.number().int().nonnegative(),
  z.number().nonnegative(),
  z.number().nonnegative()
])

/**
 * Reads `ps -A -o pid=,ppid=,pcpu=,rss=`.
 *
 * A line that does not parse is skipped rather than failing the reading: the
 * table is the operating system's, and one odd row costs one process, not the
 * whole bar.
 */
export function parseProcessTable(stdout: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of stdout.split('\n')) {
    const parsed = RowSchema.safeParse(line.trim().split(/\s+/).map(Number))
    if (!parsed.success) continue
    const [pid, ppid, cpu, rss] = parsed.data
    rows.push({ pid, ppid, cpu, memory: rss * 1024 })
  }
  return rows
}

/**
 * Reads `lsof -Fn`: a `p` line opens a process, an `n` line names its file.
 *
 * Asked with `-d cwd`, the one file per process is its working directory.
 */
export function parseWorkingDirectories(stdout: string): Map<number, string> {
  const found = new Map<number, string>()
  let pid: number | null = null
  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n') && pid !== null) found.set(pid, line.slice(1))
  }
  return found
}

/** A dev server is the `run` script; every other workspace session is a terminal. */
export function terminalKind(purpose: TerminalOwner['purpose']): ResourceKind {
  return purpose === 'run' ? 'server' : 'terminal'
}

/** The terminals that belong to a workspace, as owners of their process groups. */
export function terminalOwners(
  sessions: readonly { readonly pid: number; readonly owner: TerminalOwner }[]
): ResourceOwner[] {
  return sessions.flatMap(({ pid, owner }) =>
    owner.workspaceId === null
      ? []
      : [{ pid, workspaceId: owner.workspaceId, kind: terminalKind(owner.purpose) }]
  )
}

/**
 * The workspace a directory is inside, the deepest one when they nest.
 *
 * Inside rather than equal, because an agent may have moved into a
 * subdirectory of its worktree; and on a separator, so `anna` does not claim
 * `annabel`.
 */
function workspaceAt(directory: string, places: readonly WorkspacePlace[]): string | null {
  let best: WorkspacePlace | null = null
  for (const place of places) {
    const inside = directory === place.path || directory.startsWith(place.path + sep)
    if (inside && (best === null || place.path.length > best.path.length)) best = place
  }
  return best?.id ?? null
}

/**
 * The main process's direct children that no terminal already owns.
 *
 * These are the candidates for being an agent; Electron's helpers are among
 * them and fall out when their directory matches no workspace.
 */
export function agentCandidates(
  rows: readonly ProcessRow[],
  rootPid: number,
  owned: readonly ResourceOwner[]
): number[] {
  const taken = new Set(owned.map((owner) => owner.pid))
  return rows.filter((row) => row.ppid === rootPid && !taken.has(row.pid)).map((row) => row.pid)
}

/** The candidates whose working directory is inside a workspace, as that workspace's agents. */
export function agentOwners(
  directories: ReadonlyMap<number, string>,
  places: readonly WorkspacePlace[]
): ResourceOwner[] {
  return [...directories].flatMap(([pid, directory]) => {
    const workspaceId = workspaceAt(directory, places)
    return workspaceId === null ? [] : [{ pid, workspaceId, kind: 'agent' as const }]
  })
}

/**
 * Adds up the tree under `rootPid`, charging each subtree to its owner.
 *
 * A process inherits its parent's owner unless it is an owner itself, so a dev
 * server three levels below its pty is still that workspace's server. Rows
 * outside the tree — every other application on the machine — are ignored.
 */
export function measure(
  rows: readonly ProcessRow[],
  rootPid: number,
  owners: readonly ResourceOwner[]
): ResourceReading {
  const children = new Map<number, ProcessRow[]>()
  const byPid = new Map<number, ProcessRow>()
  for (const row of rows) {
    byPid.set(row.pid, row)
    children.set(row.ppid, [...(children.get(row.ppid) ?? []), row])
  }
  const ownerOf = new Map(owners.map((owner) => [owner.pid, owner]))

  const parts = new Map<
    string,
    { workspaceId: string; kind: ResourceKind; cpu: number; memory: number }
  >()
  const app = { cpu: 0, memory: 0 }
  const total = { cpu: 0, memory: 0 }

  const root = byPid.get(rootPid)
  const pending: { row: ProcessRow; owner: ResourceOwner | null }[] =
    root === undefined ? [] : [{ row: root, owner: null }]

  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { row } = next
    const owner = ownerOf.get(row.pid) ?? next.owner
    total.cpu += row.cpu
    total.memory += row.memory

    if (owner === null) {
      app.cpu += row.cpu
      app.memory += row.memory
    } else {
      const key = `${owner.workspaceId}\u0000${owner.kind}`
      const part = parts.get(key) ?? {
        workspaceId: owner.workspaceId,
        kind: owner.kind,
        cpu: 0,
        memory: 0
      }
      part.cpu += row.cpu
      part.memory += row.memory
      parts.set(key, part)
    }

    for (const child of children.get(row.pid) ?? []) pending.push({ row: child, owner })
  }

  return { total, app, parts: [...parts.values()] }
}

export interface ResourceQuery {
  readonly rootPid: number
  /** The terminals' owners, which `main/` knows because it spawned them. */
  readonly terminals: readonly ResourceOwner[]
  readonly workspaces: readonly WorkspacePlace[]
  /** How many cores share the load, so the reading tops out at 100%. */
  readonly cores: number
}

/**
 * One reading: the process table, then the candidates' directories.
 *
 * A failed `lsof` costs the agents their attribution and nothing else — they
 * are still in the total, charged to the application.
 */
export async function readResources(
  query: ResourceQuery,
  exec: ProcessExec = defaultProcessExec
): Promise<ResourceReading> {
  // Never below one: a zero would turn every reading into Infinity.
  const cores = Math.max(1, query.cores)
  const rows = parseProcessTable(await exec('ps', ['-A', '-o', 'pid=,ppid=,pcpu=,rss='])).map(
    (row) => ({ ...row, cpu: row.cpu / cores })
  )
  const candidates = agentCandidates(rows, query.rootPid, query.terminals)

  const directories =
    candidates.length === 0
      ? new Map<number, string>()
      : await exec('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', candidates.join(',')]).then(
          parseWorkingDirectories,
          () => new Map<number, string>()
        )

  return measure(rows, query.rootPid, [
    ...query.terminals,
    ...agentOwners(directories, query.workspaces)
  ])
}
