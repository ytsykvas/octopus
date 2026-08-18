/**
 * The per-project env file (§12.2).
 *
 * A fresh worktree never has a `.env`: it is gitignored, so `git worktree add`
 * does not bring one. That made "copy the env" the first line of nearly every
 * build script — a line that also could not be written correctly, since the
 * script has no pointer back to the repository it belongs to.
 *
 * So octopus keeps the env itself, once per project, and writes it into every
 * workspace that lacks one. It is a file rather than a field in the config for
 * the same reason the scripts are: it can then be read and edited outside the
 * app.
 *
 * Separate from `scripts.ts` deliberately. A `ScriptKind` is something we
 * execute, which is why `writeScript` sets the executable bit; an env file is
 * neither executed nor safe to make world-readable.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { projectEnv } from './paths.js'
import type { ProjectId } from './types.js'

/** An env body as accepted from the renderer, bounded like a script body. */
export const EnvBodySchema = z.string().max(64_000)

/** The name the project's env lands under inside a workspace. */
export const WORKSPACE_ENV_FILE = '.env'

/**
 * Permissions for anything holding the env.
 *
 * It carries credentials, so it is readable by its owner and nobody else —
 * the `0o755` a script gets would be wrong twice over.
 */
const ENV_MODE = 0o600

export function projectEnvPath(projectId: ProjectId, root?: string): string {
  return projectEnv(projectId, root)
}

/**
 * The project's env, or an empty string when none has been written.
 *
 * No template, unlike a script: a shell file needs its shebang to run at all,
 * whereas a starting body here would be content nobody asked to have copied
 * into their workspaces.
 */
export async function readProjectEnv(projectId: ProjectId, root?: string): Promise<string> {
  try {
    return await readFile(projectEnvPath(projectId, root), 'utf8')
  } catch {
    return ''
  }
}

export async function writeProjectEnv(
  projectId: ProjectId,
  contents: string,
  root?: string
): Promise<void> {
  const path = projectEnvPath(projectId, root)

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents, { encoding: 'utf8', mode: ENV_MODE })
}

/**
 * Writes the project's env into a workspace, unless it already has one.
 *
 * `wx` rather than checking first: it cannot clobber a `.env` somebody edited
 * inside the worktree, and it leaves no window between the check and the write.
 * Anything other than "it was already there" is a real failure and is rethrown
 * — a silently skipped env is a build that fails for reasons nowhere on screen.
 *
 * Returns whether a file was written.
 */
export async function applyProjectEnv(
  projectId: ProjectId,
  workspacePath: string,
  root?: string
): Promise<boolean> {
  const body = await readProjectEnv(projectId, root)
  // A project with nothing to copy is the normal state, and an empty `.env`
  // in a worktree is noise that some tools then prefer over their defaults.
  if (body.trim() === '') return false

  try {
    await writeFile(join(workspacePath, WORKSPACE_ENV_FILE), body, {
      encoding: 'utf8',
      flag: 'wx',
      mode: ENV_MODE
    })
    return true
  } catch (error) {
    if (alreadyExists(error)) return false
    throw error
  }
}

/** Whether a filesystem error is the `wx` flag refusing an existing file. */
function alreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}
