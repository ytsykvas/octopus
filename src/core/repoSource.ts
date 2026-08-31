/**
 * Where a project's scripts come from, now that a repository may supply them.
 *
 * Until this existed, the three scripts lived in `~/.octopus/projects/<id>/` and
 * nowhere else — one directory, on one machine. A second developer cloning the
 * same repository had to write them again, and so did the same developer on a
 * second machine. So a checkout may carry them, in `.octopus/` of its own or in
 * the `.conductor/` it already has, and **the repository wins**: a clone works
 * with nothing configured, which is the whole point.
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
import { join } from 'node:path'

import { readConductorConfig } from './conductorConfig.js'
import { REPO_DIR, assertUnlinkedPath } from './repoConfig.js'
import { trustDigest } from './repoTrust.js'
import { SCRIPT_KINDS } from './scriptEnv.js'
import { SCRIPT_FILES, type ScriptKind, readScript, scriptExists, scriptPath } from './scripts.js'
import type { ProjectId } from './types.js'

/** Where a resolved script was found, in the order they are consulted. */
export type ScriptSource = 'repoOctopus' | 'repoConductor' | 'project'

/** How a script is started. */
export type ScriptRun =
  /** A file to execute. Its own executable bit applies, as it always has. */
  | { readonly type: 'file'; readonly path: string }
  /**
   * A command line for the shell.
   *
   * Conductor's settings name commands rather than files, and a command line
   * has to reach the shell as written — quoting `-p $CONDUCTOR_PORT` would make
   * the whole line the name of a program.
   */
  | { readonly type: 'command'; readonly command: string }

export interface ResolvedScript {
  readonly kind: ScriptKind
  readonly source: ScriptSource
  /** Where it came from, as the reader would go looking for it. */
  readonly from: string
  readonly run: ScriptRun
  /**
   * The text that is shown before it is approved.
   *
   * The file's body, or the command line. Whatever is shown is what runs: an
   * approval over a summary is an approval of the summary.
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
async function octopusScript(cwd: string, kind: ScriptKind): Promise<ResolvedScript | null> {
  const relative = octopusScriptPath(kind)
  await assertUnlinkedPath(cwd, relative)

  const path = join(cwd, relative)

  let contents: string
  try {
    contents = await readFile(path, 'utf8')
  } catch {
    return null
  }

  return { kind, source: 'repoOctopus', from: relative, run: { type: 'file', path }, contents }
}

/**
 * Which script runs for one kind, and where it came from.
 *
 * `.octopus/` first because it is ours and unambiguous, `.conductor/` next
 * because a repository set up for that tool should work here unchanged, and the
 * project's own settings last — the local answer for a checkout that carries
 * neither.
 *
 * `cwd` is the worktree a run would happen in, or the checkout when the
 * question is asked with no workspace open. Those can differ: a branch may add
 * a script the checkout has not got, and the answer has to be about the
 * directory the script would actually run in.
 */
export async function resolveScript(
  kind: ScriptKind,
  cwd: string,
  projectId: ProjectId,
  root?: string
): Promise<ResolvedScript | null> {
  const own = await octopusScript(cwd, kind)
  if (own !== null) return own

  const conductor = await readConductorConfig(cwd)
  const named = conductor?.scripts[kind]
  if (named !== undefined) {
    return {
      kind,
      source: 'repoConductor',
      from: named.path,
      run: { type: 'command', command: named.command },
      contents: named.command
    }
  }

  if (await scriptExists(kind, projectId, root)) {
    const path = scriptPath(kind, projectId, root)
    return {
      kind,
      source: 'project',
      from: path,
      run: { type: 'file', path },
      contents: await readScript(kind, projectId, root)
    }
  }

  return null
}

/** What runs in one workspace, and whether the repository's part is approved. */
export interface ScriptsInWorkspace {
  readonly approved: boolean
  readonly scripts: Readonly<Partial<Record<ScriptKind, ResolvedScript>>>
}

export async function resolveScripts(
  cwd: string,
  projectId: ProjectId,
  root?: string
): Promise<Readonly<Partial<Record<ScriptKind, ResolvedScript>>>> {
  const resolved: Partial<Record<ScriptKind, ResolvedScript>> = {}

  for (const kind of SCRIPT_KINDS) {
    const script = await resolveScript(kind, cwd, projectId, root)
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
