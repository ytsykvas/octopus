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
 * may be a file the repository carries, a command line out of its Conductor
 * settings, or the project's own.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { ResolvedScript } from './repoSource.js'
import { conductorEnv, scriptEnv } from './scriptEnv.js'
import { resolveShell } from './terminal.js'

const run = promisify(execFile)

/**
 * How long the script has.
 *
 * Dropping a database is seconds; anything past this is waiting on something
 * that will not arrive, and a workspace that cannot be removed is worse than
 * one that left something behind.
 */
const TIMEOUT_MS = 30_000

/** How the script is run, injected so tests never spawn a shell. */
export type RunScript = (
  file: string,
  args: readonly string[],
  options: { cwd: string; env: Record<string, string>; timeout: number }
) => Promise<unknown>

const defaultRun: RunScript = async (file, args, options) => {
  await run(file, [...args], { ...options, env: { ...process.env, ...options.env } })
}

/** What the script needs to know about the workspace it is taking apart. */
export interface ArchiveValues {
  readonly rootPath: string
  readonly workspaceName: string
  readonly path: string
  readonly port: number
  readonly defaultBranch: string
}

/**
 * Runs a workspace's cleanup script, if it has one.
 *
 * **Nothing here can stop the removal.** A script that fails, hangs or was
 * never written all end the same way: the workspace goes. That is deliberate
 * and it is what Conductor does too — a workspace you cannot delete because a
 * cleanup script is broken is a worse problem than the one being cleaned up.
 *
 * Answers with what went wrong, for a caller that wants to say so, or null.
 */
export async function runArchiveScript(
  script: ResolvedScript | null,
  values: ArchiveValues,
  runner: RunScript = defaultRun
): Promise<string | null> {
  if (script === null) return null

  /*
   * A file is executed directly, as it always was — its own executable bit
   * applies. A command line goes to a shell with `-c`, because that is what it
   * is: a line somebody wrote expecting a shell to read it. PATH is already the
   * login shell's by then (`src/main/loginPath.ts`), so `dropdb` and `kubectl`
   * resolve the way they do in a terminal.
   */
  const invocation =
    script.run.type === 'file'
      ? { file: script.run.path, args: [] as readonly string[] }
      : { file: resolveShell(), args: ['-c', script.run.command] }

  try {
    await runner(invocation.file, invocation.args, {
      cwd: values.path,
      env: {
        ...scriptEnv('archive', values),
        // Only for a script that came from there. A project with no Conductor
        // settings has no business being handed Conductor's vocabulary.
        ...(script.source === 'repoConductor' ? conductorEnv('archive', values) : {})
      },
      timeout: TIMEOUT_MS
    })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
