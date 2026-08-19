/**
 * The script a workspace runs on its way out (§12.2).
 *
 * `setup.sh` gives a workspace things of its own — a database named after it, a
 * container, a directory. Nothing took them back: removing a workspace removed
 * its worktree and left the rest behind, so a project that made two databases
 * per workspace accumulated them for ever.
 *
 * It runs in the worktree while that still exists, with the same environment
 * the other scripts get.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { ROOT_VARIABLE, scriptPath, WORKSPACE_VARIABLE } from './scripts.js'
import type { ProjectId } from './types.js'

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
  path: string,
  options: { cwd: string; env: Record<string, string>; timeout: number }
) => Promise<unknown>

const defaultRun: RunScript = async (path, options) => {
  await run(path, [], { ...options, env: { ...process.env, ...options.env } })
}

/**
 * Runs a project's archive script for one workspace, if it has one.
 *
 * **Nothing here can stop the removal.** A script that fails, hangs or was
 * never written all end the same way: the workspace goes. That is deliberate
 * and it is what Conductor does too — a workspace you cannot delete because a
 * cleanup script is broken is a worse problem than the one being cleaned up.
 *
 * Answers with what went wrong, for a caller that wants to say so, or null.
 */
export async function runArchiveScript(
  projectId: ProjectId,
  values: { readonly rootPath: string; readonly workspaceName: string; readonly path: string },
  root?: string,
  runner: RunScript = defaultRun
): Promise<string | null> {
  const path = scriptPath('archive', projectId, root)

  try {
    await runner(path, {
      cwd: values.path,
      env: { [ROOT_VARIABLE]: values.rootPath, [WORKSPACE_VARIABLE]: values.workspaceName },
      timeout: TIMEOUT_MS
    })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
