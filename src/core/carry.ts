/**
 * Files carried from the project's checkout into every new workspace (§12.2).
 *
 * A worktree holds what git tracks and nothing else, so everything gitignored
 * is missing from a fresh one: the `.env` a Rails app boots from, the
 * `config/master.key` that decrypts its credentials, a local settings file an
 * agent needs. Without them the workspace cannot run, and the first line of
 * every setup script was a `cp` that had no way to find the original.
 *
 * A list of paths rather than one file's contents. Contents kept here would be
 * a copy that goes stale — and it did: a snapshot taken while a `.env` pointed
 * at production kept pointing there long after the checkout had moved on. The
 * checkout is the source; this only says which parts of it travel.
 */

import { constants, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize } from 'node:path'

import { z } from 'zod'

import { projectCarry } from './paths.js'
import type { ProjectId } from './types.js'

/** The list as accepted from the renderer: one path per line. */
export const CarryListSchema = z.string().max(8_000)

/**
 * What a project carries when it has said nothing.
 *
 * `.env` alone: it is the file almost every project needs and the one nobody
 * expects to have to ask for. Anything beyond it differs per stack, which is
 * what the list is for.
 */
const DEFAULT_LIST = `# One path per line, relative to the project's checkout.
# Each is copied into a new workspace unless it already has one.
# Lines starting with # are ignored.

.env
`

export function carryPath(projectId: ProjectId, root?: string): string {
  return projectCarry(projectId, root)
}

/** The list a project has written, or the starting one where it has not. */
export async function readCarryList(projectId: ProjectId, root?: string): Promise<string> {
  try {
    return await readFile(carryPath(projectId, root), 'utf8')
  } catch {
    return DEFAULT_LIST
  }
}

export async function writeCarryList(
  projectId: ProjectId,
  contents: string,
  root?: string
): Promise<void> {
  const path = carryPath(projectId, root)

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents, 'utf8')
}

/**
 * The paths a list names, with the comments and the blank lines gone.
 *
 * Anything absolute or reaching outside the checkout is dropped rather than
 * refused. The list is edited by hand in a text box, and one bad line should
 * not stop the rest of a workspace being prepared — but neither should it read
 * a file the project does not contain.
 */
export function carriedPaths(list: string): string[] {
  return list
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => !isAbsolute(line) && !normalize(line).startsWith('..'))
}

/**
 * Copies a project's carried files into a workspace.
 *
 * Never over a file the worktree already has — a tracked `.env.example`, or one
 * somebody edited in the workspace — which is what `COPYFILE_EXCL` says without
 * a check that could be raced. A file the checkout does not have is not an
 * error either: a list is written once and a project's needs change.
 *
 * Answers with the paths it actually wrote, so a caller can say what it did.
 */
export async function carryInto(
  projectId: ProjectId,
  repoPath: string,
  workspacePath: string,
  root?: string
): Promise<string[]> {
  // Every path here is relative and cannot climb out: `carriedPaths` is what
  // guarantees it, so nothing below has to check again.
  const list = carriedPaths(await readCarryList(projectId, root))
  const written: string[] = []

  for (const path of list) {
    const from = join(repoPath, path)
    const to = join(workspacePath, path)

    try {
      await mkdir(dirname(to), { recursive: true })
      await copyFile(from, to, constants.COPYFILE_EXCL)
      written.push(path)
    } catch {
      // Already there, or the checkout does not have it. Both are ordinary.
    }
  }

  return written
}
