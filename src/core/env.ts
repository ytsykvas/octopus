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
 *
 * Reading, checking and filling in the text is `envBlock.ts`; this module is
 * the files.
 */

import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import {
  CLOSE,
  OPEN,
  substituteEnv,
  withoutBlock,
  withoutMarkers,
  type WorkspaceValues
} from './envBlock.js'
import { unlinkedInside } from './paths.js'
import { WorkspaceError } from './workspaces.js'
import { writeTextFile } from './persist.js'

/** A block of overrides as accepted from the renderer. */
export const EnvBodySchema = z.string().max(16_000)

/** It carries credentials, so it is readable by its owner and nobody else. */
const MODE = 0o600

/**
 * A workspace's env file as it stands, or null where it has none.
 *
 * Read rather than reconstructed: the point of showing it is the file the
 * scripts will actually read, carried lines and hand edits included. A preview
 * built from the block alone would agree with everything except reality.
 */
export async function readWorkspaceEnv(
  workspacePath: string,
  envFile: string
): Promise<string | null> {
  try {
    return await readFile(join(workspacePath, envFile), 'utf8')
  } catch {
    return null
  }
}

/**
 * Refuses a path a link would redirect out of the worktree.
 *
 * `envFile` is held to the textual rule when it is stored, and that is not the
 * same question: a worktree can track a symlinked directory, so `config/.env`
 * can resolve anywhere. Two of the three writers below `rm` through this path,
 * and all three write credentials.
 *
 * Refused rather than skipped, which is the opposite of what `carryInto` does
 * with a bad line — and deliberately. A carry list is typed by hand and a
 * workspace missing one file still runs; a workspace whose variables were never
 * written fails its first build for a reason nothing on screen names. At
 * creation the rollback then takes the worktree with it, which is the right end
 * for a workspace that could not have worked.
 */
async function assertInsideWorktree(workspacePath: string, envFile: string): Promise<void> {
  if (await unlinkedInside(workspacePath, envFile)) return

  throw new WorkspaceError(
    'envPathEscapes',
    { file: envFile },
    `${envFile} leaves the workspace through a symbolic link.`
  )
}

/**
 * Takes our block out of a file, leaving everything else.
 *
 * For the file a project **used** to name. `applyEnvOverrides` only ever
 * touches the one named now, so changing the setting left a live block —
 * credentials, and a port frozen at the moment of the switch — in a file the
 * stack very likely still reads.
 *
 * A file left holding nothing goes, for the same reason `applyEnvOverrides`
 * removes it: an empty file is still a file, and `carryInto` would refuse to
 * write over it.
 */
export async function removeEnvBlock(workspacePath: string, envFile: string): Promise<boolean> {
  await assertInsideWorktree(workspacePath, envFile)
  const path = join(workspacePath, envFile)

  let existing: string
  try {
    existing = await readFile(path, 'utf8')
  } catch {
    return false
  }

  const kept = withoutBlock(existing)
  if (kept === existing) return false

  if (kept.trim() === '') await rm(path, { force: true })
  else await writeTextFile(path, kept, MODE)

  return true
}

/**
 * Removes a workspace env file that holds nothing but our own block.
 *
 * Called **before** the carried files land, and it exists because the two
 * mechanisms deadlocked. `carryInto` copies with `COPYFILE_EXCL`, so it never
 * writes over a file the worktree already has — correct, and it made the block
 * a permanent obstacle: for a project cloned from GitHub the worktree has no env
 * file, the block creates one, and the real `.env` appearing in the checkout
 * later could never be copied in again. `carryInto` swallowed the `EEXIST` and
 * the run reported success.
 *
 * Deleting is safe precisely because the block is regenerated a few lines
 * later. A file with anything of the user's in it — a carried line, a hand edit
 * — is left alone: `withoutBlock` is what tells the two apart.
 *
 * Answers with whether it removed anything.
 */
export async function discardIfOnlyBlock(workspacePath: string, envFile: string): Promise<boolean> {
  await assertInsideWorktree(workspacePath, envFile)
  const path = join(workspacePath, envFile)

  let existing: string
  try {
    existing = await readFile(path, 'utf8')
  } catch {
    return false
  }

  // Nothing of ours in it, or something of somebody else's alongside: keep it.
  if (!existing.includes(OPEN) || withoutBlock(existing).trim() !== '') return false

  await rm(path, { force: true })
  return true
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
export async function applyEnvOverrides(stored: string, values: WorkspaceValues): Promise<boolean> {
  // Markers out before anything else: one left in the body would make the next
  // read cut in the middle of our own block.
  await assertInsideWorktree(values.path, values.envFile)

  const body = substituteEnv(withoutMarkers(stored.trim()), values).trim()
  const path = join(values.path, values.envFile)

  let existing = ''
  try {
    existing = await readFile(path, 'utf8')
  } catch {
    // No `.env` yet, which is the ordinary state of a fresh clone's workspace.
  }

  const kept = withoutBlock(existing)

  // Nothing to add: the block goes. A file that held only a block goes with it,
  // rather than being left empty — an empty file is still a file, and
  // `carryInto` would refuse to write over it for ever after.
  if (body === '') {
    if (kept === existing) return false

    if (kept.trim() === '') await rm(path, { force: true })
    else await writeTextFile(path, kept, MODE)

    return true
  }

  /*
   * The kept part with its trailing blank lines taken off, so writing twice
   * lands the same file.
   *
   * Without it each run left a newline where the last block had been and then
   * added its own separator, so the file gained a blank line at the head every
   * time — an idempotent operation that was not.
   */
  const head = kept.replace(/\s+$/, '')

  await writeTextFile(
    path,
    head === '' ? `${OPEN}\n${body}\n${CLOSE}\n` : `${head}\n\n${OPEN}\n${body}\n${CLOSE}\n`,
    MODE
  )

  return true
}
