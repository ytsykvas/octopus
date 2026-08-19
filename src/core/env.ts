/**
 * Variables a project adds to every workspace's `.env` (§12.2).
 *
 * `carry.ts` brings files out of the checkout, which answers nothing for a
 * project cloned from GitHub: a fresh clone has no `.env` and no
 * `config/master.key` by definition — they are gitignored, so GitHub never had
 * them. There is nothing to copy, and the first sign of it is the framework
 * complaining about credentials.
 *
 * It also cannot help when the file that *was* copied is wrong. A checkout left
 * pointing at production hands every workspace production, quietly.
 *
 * So a project may keep a small block of variables and octopus writes it at the
 * **end** of the workspace's `.env`. Last wins — `dotenv` and every
 * implementation of it keeps the final definition — which is the same trick the
 * Conductor setup this was measured against performs by hand, and for the same
 * stated reason.
 *
 * The block stays out of the repository: these are one machine's credentials.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { projectEnv } from './paths.js'
import type { ProjectId } from './types.js'

/** A block of overrides as accepted from the renderer. */
export const EnvBodySchema = z.string().max(16_000)

/** The file the block is written into, inside the workspace. */
export const WORKSPACE_ENV_FILE = '.env'

/**
 * What wraps the block once it is in somebody's `.env`.
 *
 * Two markers rather than one so a rewrite replaces only what we wrote. With a
 * single opening marker the tidiest implementation is to truncate there — and
 * that eats any line somebody added inside the workspace afterwards.
 */
const OPEN = '# >>> octopus: project overrides'
const CLOSE = '# <<< octopus'

/** It carries credentials, so it is readable by its owner and nobody else. */
const MODE = 0o600

export function projectEnvPath(projectId: ProjectId, root?: string): string {
  return projectEnv(projectId, root)
}

/**
 * A project's overrides, or an empty string where it has none.
 *
 * No template, unlike a script: a variable nobody wrote has no value worth
 * guessing at, and a placeholder would end up in a real `.env`.
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
  await writeFile(path, contents, { encoding: 'utf8', mode: MODE })
}

/**
 * The file with any block we wrote taken out, and its trailing blank lines.
 *
 * Anything outside the markers is somebody else's and comes back untouched,
 * including whatever sits below the block.
 */
function withoutBlock(contents: string): string {
  const open = contents.indexOf(OPEN)
  if (open === -1) return contents

  const close = contents.indexOf(CLOSE, open)
  // An opening marker with no closing one means the file was edited into a
  // shape we did not write. Everything from it on is ours to replace; there is
  // nothing else to do that does not risk keeping half a block.
  const after = close === -1 ? contents.length : close + CLOSE.length

  return (contents.slice(0, open) + contents.slice(after)).replace(/\n{3,}$/, '\n')
}

/**
 * Writes a project's overrides into a workspace's `.env`, replacing any earlier
 * block.
 *
 * Called after the carried files land and again before a run, so a project that
 * gained a variable afterwards reaches a workspace made before it. A workspace
 * with no `.env` at all gets one holding just the block — which is the whole
 * answer for a project cloned from GitHub, where there was never a file to
 * copy.
 *
 * Answers with whether anything was written.
 */
export async function applyEnvOverrides(
  projectId: ProjectId,
  workspacePath: string,
  root?: string
): Promise<boolean> {
  const body = (await readProjectEnv(projectId, root)).trim()
  const path = join(workspacePath, WORKSPACE_ENV_FILE)

  let existing = ''
  try {
    existing = await readFile(path, 'utf8')
  } catch {
    // No `.env` yet, which is the ordinary state of a fresh clone's workspace.
  }

  const kept = withoutBlock(existing)

  // Nothing to add: the block goes, and a file that held only a block is left
  // empty rather than carrying a header for nothing.
  if (body === '') {
    if (kept === existing) return false

    await writeFile(path, kept, { encoding: 'utf8', mode: MODE })
    return true
  }

  const separator = kept === '' || kept.endsWith('\n') ? '' : '\n'
  await writeFile(path, `${kept}${separator}\n${OPEN}\n${body}\n${CLOSE}\n`, {
    encoding: 'utf8',
    mode: MODE
  })

  return true
}
