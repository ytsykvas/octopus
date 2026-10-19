/**
 * Where a project's scripts come from, now that a repository may supply them.
 *
 * Until this existed, the three scripts lived in `~/.octopus/projects/<id>/` and
 * nowhere else — one directory, on one machine. A second developer cloning the
 * same repository had to write them again, and so did the same developer on a
 * second machine. So a checkout may carry them, in a `.octopus/` of its own, and
 * **the repository wins**: a clone works with nothing configured, which is the
 * whole point.
 *
 * That inverts what `repo-config.md` decided, and the reason it can be inverted
 * is worth stating. The objection to a live layer was that it would be silently
 * *off* in the situation it exists for — a project re-added after a wipe has no
 * approval and would fall back to a local copy that had just been deleted. With
 * the repository first there is nothing to fall back to, so the failure is not
 * silent: the run refuses and says which file it would have run.
 *
 * What remains of the objection is that this executes shell which arrived with a
 * `git pull`, and that is what the digest here is for. Nothing in this module
 * runs anything; it answers *what would run*, so that it can be shown, approved
 * and only then handed to a terminal.
 *
 * The one thing a repository may never supply is the environment. Variables are
 * credentials and stay on the machine (`env.ts`), which is the line the whole
 * arrangement rests on: **the repository decides what runs, the machine decides
 * what it runs against.** A pull can change the build script; it cannot point a
 * workspace at production.
 */

import { readFile } from 'node:fs/promises'
import { join, normalize } from 'node:path'

import { type CarriedFile, carriedFiles, readCarryList } from './carry.js'
import { type GitExec, ignoredAmong, isIgnored } from './git.js'
import { INSTRUCTION_FILES, type InstructionKind } from './instructions.js'
import { unlinkedInside } from './paths.js'
import { REPO_DIR, assertUnlinkedPath, readStatedCarry } from './repoConfig.js'
import { trustDigest } from './repoTrust.js'
import { SCRIPT_KINDS } from './scriptEnv.js'
import { SCRIPT_FILES, type ScriptKind, readScript, scriptExists, scriptPath } from './scripts.js'
import { scriptItem, type SourceItemId } from './sourceItems.js'
import type { ProjectId } from './types.js'

/** Where a resolved script was found, in the order they are consulted. */
export type ScriptSource = 'repoOctopus' | 'project'

export interface ResolvedScript {
  readonly kind: ScriptKind
  readonly source: ScriptSource
  /** Where it came from, as the reader would go looking for it. */
  readonly from: string
  /** The file to execute. Its own executable bit applies, as it always has. */
  readonly path: string
  /**
   * The file's body: the text that is shown before it is approved, and what is
   * digested. A file's contents *are* the program, so showing every byte of them
   * is an approval of the program.
   */
  readonly contents: string
}

/** Where a repository keeps octopus's own scripts, relative to a checkout. */
export function octopusScriptPath(kind: ScriptKind): string {
  return join(REPO_DIR, 'scripts', SCRIPT_FILES[kind])
}

/**
 * A script a checkout carries under `.octopus/`, or null.
 *
 * Checked segment by segment first: a symlinked `.octopus` would otherwise hand
 * back a file from outside the checkout under a path inside it — and this one
 * is about to be executed.
 */
export async function octopusScript(cwd: string, kind: ScriptKind): Promise<ResolvedScript | null> {
  const relative = octopusScriptPath(kind)
  await assertUnlinkedPath(cwd, relative)

  const path = join(cwd, relative)

  let contents: string
  try {
    contents = await readFile(path, 'utf8')
  } catch {
    return null
  }

  return { kind, source: 'repoOctopus', from: relative, path, contents }
}

/**
 * Which script runs for one kind, and where it came from.
 *
 * `.octopus/` first because it is the repository's own answer, and the
 * project's own settings last — the local answer for a checkout that carries
 * none.
 *
 * `cwd` is the worktree a run would happen in, or the checkout when the
 * question is asked with no workspace open. Those can differ: a branch may add
 * a script the checkout has not got, and the answer has to be about the
 * directory the script would actually run in.
 *
 * `preferLocal` is "use mine instead": the repository is not asked at all, so
 * a project that chose its own script runs it — or, having written none, runs
 * nothing — whatever `.octopus/` holds.
 */
export async function resolveScript(
  kind: ScriptKind,
  cwd: string,
  projectId: ProjectId,
  root?: string,
  preferLocal = false
): Promise<ResolvedScript | null> {
  const own = preferLocal ? null : await octopusScript(cwd, kind)
  if (own !== null) return own

  if (await scriptExists(kind, projectId, root)) {
    const path = scriptPath(kind, projectId, root)
    return {
      kind,
      source: 'project',
      from: path,
      path,
      contents: await readScript(kind, projectId, root)
    }
  }

  return null
}

/** What runs in one workspace, and whether the repository's part is approved. */
export interface ScriptsInWorkspace {
  readonly approved: boolean
  /** What approving would record, handed back so the approval covers what was shown. */
  readonly digest: string
  readonly scripts: Readonly<Partial<Record<ScriptKind, ResolvedScript>>>
}

export async function resolveScripts(
  cwd: string,
  projectId: ProjectId,
  root?: string,
  preferLocal: readonly SourceItemId[] = []
): Promise<Readonly<Partial<Record<ScriptKind, ResolvedScript>>>> {
  const resolved: Partial<Record<ScriptKind, ResolvedScript>> = {}

  for (const kind of SCRIPT_KINDS) {
    const script = await resolveScript(
      kind,
      cwd,
      projectId,
      root,
      preferLocal.includes(scriptItem(kind))
    )
    if (script !== null) resolved[kind] = script
  }

  return resolved
}

/**
 * What has to be approved before any of these may run, or `''` for nothing.
 *
 * **Only what the repository supplies.** A script the user wrote in Project
 * settings is not gated: they wrote it, and asking somebody to approve their own
 * text is the kind of dialog people learn to click through.
 *
 * The empty string means there is nothing to approve, which is how "no
 * repository scripts" is told from "approved" without a second flag — the same
 * convention `repoTrust.ts` already uses for capability files.
 *
 * Sorted by kind, so the order the scripts were resolved in cannot change the
 * answer.
 */
export function scriptsDigest(
  scripts: Readonly<Partial<Record<ScriptKind, ResolvedScript>>>
): string {
  const supplied = SCRIPT_KINDS.flatMap((kind) => {
    const script = scripts[kind]
    return script === undefined || script.source === 'project'
      ? []
      : [{ path: `${kind}:${script.from}`, contents: script.contents }]
  })

  return trustDigest(supplied)
}

/** Where a repository keeps octopus's own instructions, relative to a checkout. */
export function octopusInstructionPath(kind: InstructionKind): string {
  return join(REPO_DIR, 'instructions', INSTRUCTION_FILES[kind])
}

/** One instruction a repository supplies, and which file it came from. */
export interface RepoInstruction {
  readonly source: 'repoOctopus'
  readonly from: string
  readonly body: string
}

/**
 * The prose a repository supplies for one action, or null.
 *
 * The same chain as the scripts and for the same reason: a clone should send
 * the pull-request description this project wants without anybody configuring
 * it. Unlike a script it is **not** gated — this text goes into the log as a
 * visible user message, where it is read before it does anything, and a dialog
 * in front of every one of them would be friction for no gain.
 *
 * Anything it does not supply falls through to the project's own, then the
 * installation's, then the written template.
 */
export async function repoInstruction(
  kind: InstructionKind,
  cwd: string
): Promise<RepoInstruction | null> {
  const relative = octopusInstructionPath(kind)
  await assertUnlinkedPath(cwd, relative)

  try {
    const body = await readFile(join(cwd, relative), 'utf8')
    // An empty file is how a repository says "nothing extra here", exactly as
    // it is for the project's own copy.
    return { source: 'repoOctopus', from: relative, body }
  } catch {
    // Not carried under `.octopus/`, which is the ordinary case.
  }

  return null
}

/** What decides whether a repository's carry list is read at all. */
export interface CarryChoice {
  /** "Use mine instead": the repository's list is not read. */
  readonly preferLocal: boolean
  /** Whether the repository is trusted (`trustRepository`). */
  readonly trusted: boolean
}

/**
 * Which candidates git ignores: one ask for all, and one each if git refuses
 * the batch.
 *
 * One path git will not answer for — inside a submodule, say — fails the whole
 * `check-ignore`, and without the second pass it took every other repository
 * line with it. Asked alone, a line git still refuses is simply not honoured:
 * not a reason to fail a workspace, since the project's own list is still
 * right and a line nobody could vouch for is one not to carry.
 */
async function ignoredBy(exec: GitExec, candidates: readonly string[]): Promise<Set<string>> {
  try {
    return await ignoredAmong(exec, candidates)
  } catch {
    // One at a time: the list may run to thousands of lines, and this is the
    // path a list built to fail the batch takes.
    const ignored = new Set<string>()
    for (const path of candidates) {
      if (await isIgnored(exec, `./${path}`).catch(() => false)) ignored.add(path)
    }
    return ignored
  }
}

/** The key two lines are the same file by: normalised, and case-folded for macOS. */
function sameFile(path: string): string {
  return normalize(path).toLowerCase()
}

/**
 * The files to carry into one worktree: the project's own list, and what the
 * repository's `.octopus/carry` adds to it.
 *
 * Read from `cwd`, the worktree being prepared — the branch's list is the one
 * that counts, not the checkout's. Obeying a committed list means letting a
 * branch choose which of this machine's gitignored files land where the agent
 * reads them and `git add -A` commits them, so a repository line has to pass
 * every one of these:
 *
 * - **The repository is trusted.** The same gate as the repository's env file,
 *   and the same decision as for its scripts: trust accepts what the worktree
 *   holds, whoever wrote it. The worktree is the agent's to write, so a trusted
 *   project also obeys a list the agent wrote there — with a `.gitignore` line
 *   to match, `.env.production` comes in on the next run — exactly as it runs
 *   a script the agent wrote. Untrusted, none of it applies.
 * - **Only its destination is used.** Its file comes from the project's
 *   checkout, as a bare line's does. `.env = ~/.ssh/id_rsa` would otherwise
 *   copy a private key in.
 * - **No link along it, in the worktree or in the checkout** — walked
 *   normalised, so `x/../leak.txt` is checked as `leak.txt`. A link in the
 *   worktree would redirect the write; a checkout tracking
 *   `leak.txt -> ~/.ssh/id_rsa` would hand the key over under an innocent
 *   name.
 * - **git ignores it in that worktree.** A branch listing `.env` without
 *   ignoring it would have the user's real one land as a file the next commit
 *   publishes. One `check-ignore` for every line, then one each if git
 *   refuses the batch; a line git still refuses is not honoured, and nothing
 *   here stops the workspace.
 * - **The local line wins on the same path**, `= source` and all, and a line
 *   only the project lists is kept. A repository list replacing the local one
 *   would silently drop a `config/master.key` the user added — the failure the
 *   carry list was written to prevent.
 *
 * A list that cannot be read — behind a link, too long — counts as none, so
 * the project's own still applies (`readStatedCarry`).
 */
export async function resolveCarry(
  cwd: string,
  repoPath: string,
  projectId: ProjectId,
  exec: GitExec,
  choice: CarryChoice,
  root?: string
): Promise<CarriedFile[]> {
  const own = carriedFiles(await readCarryList(projectId, root))
  if (choice.preferLocal || !choice.trusted) return own

  const stated = await readStatedCarry(cwd)
  if (stated === null) return own

  const taken = new Set(own.map(({ path }) => sameFile(path)))
  const candidates: string[] = []

  for (const { path } of carriedFiles(stated)) {
    const key = sameFile(path)
    if (taken.has(key)) continue
    taken.add(key)

    if (!(await unlinkedInside(cwd, path))) continue
    if (!(await unlinkedInside(repoPath, path))) continue
    candidates.push(path)
  }

  const ignored = await ignoredBy(exec, candidates)

  return [
    ...own,
    ...candidates.filter((path) => ignored.has(path)).map((path) => ({ path, from: null }))
  ]
}
