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
 * at production kept pointing there long after the checkout had moved on. This
 * names files; it never holds them.
 *
 * The checkout is where they come from by default, and a line may say
 * otherwise. That exists because a project added by cloning it from GitHub has
 * a checkout with **no** gitignored file in it — they were never pushed — while
 * the real `.env` sits in another copy of the same repository, on the same
 * disk. A workspace then came up with nothing and said nothing about it.
 */

import { constants, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

import { z } from 'zod'

import { insideWorktree, projectCarry, unlinkedInside } from './paths.js'
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
#
# A line may say where its file comes from, for a checkout that has not got it:
#   .env = ~/another/checkout/.env

.env
`

export function carryPath(projectId: ProjectId, root?: string): string {
  return projectCarry(projectId, root)
}

/**
 * What is written, or null where nothing is.
 *
 * The distinction `readCarryList` cannot make: it answers with the starting
 * list for a file that is absent, which is the right answer for an editor and
 * the wrong one for exporting into a repository — a list nobody has touched is
 * not a setting worth committing.
 */
export async function storedCarryList(projectId: ProjectId, root?: string): Promise<string | null> {
  try {
    return await readFile(carryPath(projectId, root), 'utf8')
  } catch {
    return null
  }
}

/** The list a project has written, or the starting one where it has not. */
export async function readCarryList(projectId: ProjectId, root?: string): Promise<string> {
  return (await storedCarryList(projectId, root)) ?? DEFAULT_LIST
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

/** One line of the list: where the file lands, and where it comes from. */
export interface CarriedFile {
  /**
   * Relative to the worktree, and checked to stay inside it — twice.
   *
   * `carriedFiles` answers about the string, and `carryInto` walks the
   * destination's segments before it writes: a relative path is not the same as
   * a file landing inside, once a tracked symlink is in the way.
   */
  readonly path: string
  /**
   * Where to copy it from, or null for the project's own checkout.
   *
   * A fact about this machine rather than about the project, which is why it
   * never travels: `carryListForExport` takes it back out again.
   */
  readonly from: string | null
}

/**
 * Splits one line into where the file lands and where it comes from.
 *
 * `.env` is the form that has always existed and means the checkout.
 * `.env = ~/work/planner/.env` is the other one, and it exists because a
 * checkout cloned fresh from GitHub has no gitignored file to offer — the
 * `.env` is on the disk, in another copy of the same repository, and there was
 * no way to say so.
 *
 * Split on the **first** `=` only: everything after it is one path, and a path
 * may contain another `=`.
 */
function splitLine(line: string): CarriedFile {
  const at = line.indexOf('=')
  if (at === -1) return { path: line, from: null }

  const from = line.slice(at + 1).trim()

  return { path: line.slice(0, at).trim(), from: from === '' ? null : from }
}

/**
 * The files a list names, with the comments and the blank lines gone.
 *
 * A destination reaching outside the checkout is dropped rather than refused.
 * The list is edited by hand in a text box, and one bad line should not stop
 * the rest of a workspace being prepared — but neither should it write a file
 * the worktree does not contain. **That rule applies to the left side alone**,
 * which is the half that decides where anything is written; the right side only
 * ever says what is read.
 */
export function carriedFiles(list: string): CarriedFile[] {
  return list
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map(splitLine)
    .filter(({ path }) => insideWorktree(path))
}

/**
 * The same list with every source taken out.
 *
 * `.octopus/carry` is committed and read by everybody who clones the
 * repository, and `~/work/planner/.env` is a fact about one laptop. So what
 * travels is the list as it always was — the files, not where this machine
 * happens to keep them.
 *
 * `null` stays `null`: a list nobody has written is still not a setting worth
 * committing, which is the distinction `storedCarryList` exists to make.
 */
export function carryListForExport(list: string | null): string | null {
  if (list === null) return null

  return list
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#')) return line

      const at = line.indexOf('=')
      return at === -1 ? line : line.slice(0, at).trimEnd()
    })
    .join('\n')
}

/**
 * Where one file is read from.
 *
 * A line with no source means the checkout, which is the whole of what this
 * did before. A source is expanded for `~` and then used as it stands, and one
 * that is still relative resolves against the checkout — the same thing a bare
 * path already means, so there are three spellings and one rule rather than an
 * error nobody would read.
 *
 * Only ever a *read*. Where the file lands is decided by `path` alone, which
 * `carriedFiles` has already confined to the worktree.
 */
function sourcePath(source: string | null, repoPath: string, path: string): string {
  if (source === null) return join(repoPath, path)

  const expanded =
    source === '~' || source.startsWith('~/') ? join(homedir(), source.slice(1)) : source

  return isAbsolute(expanded) ? expanded : join(repoPath, expanded)
}

/** What one pass of `carryInto` did, and what it could not do. */
export interface CarryReport {
  /** Destinations this call wrote. Absent from both lists means already there. */
  readonly written: string[]
  /**
   * Destinations the list named that the worktree still does not have.
   *
   * Never a file that was already in place: that is the ordinary case and
   * reporting it would train the reader to ignore the line.
   */
  readonly missing: string[]
}

/**
 * Whether a failure means the worktree already has the file.
 *
 * `COPYFILE_EXCL` is how this refuses to overwrite, so `EEXIST` is the success
 * of a second run rather than a failure. The narrowing is the one `persist.ts`
 * and `git.ts` use — `unknown` questioned, never cast.
 */
function alreadyThere(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}

/**
 * Copies a project's carried files into a workspace.
 *
 * Never over a file the worktree already has — a tracked `.env.example`, or one
 * somebody edited in the workspace — which is what `COPYFILE_EXCL` says without
 * a check that could be raced.
 *
 * A file the checkout has not got does not stop a workspace being prepared
 * either: a list is written once and a project's needs change. **But it is not
 * the same thing as one already in place, and treating the two alike is how a
 * workspace comes up unable to run with nothing anywhere saying why.** That
 * happened: a project re-cloned from GitHub had neither `.env` nor
 * `config/master.key` — gitignored, so GitHub never had them — nothing was
 * carried, nothing was said, and the first sign was a setup script stopping on
 * a variable it could not read, which reads as a script's fault and is not.
 *
 * So the answer is both halves. A destination refused by `unlinkedInside`
 * counts as missing too: the reasons differ, but the sentence the reader needs
 * is the same one — the list names this file and your worktree has not got it.
 */
export async function carryInto(
  projectId: ProjectId,
  repoPath: string,
  workspacePath: string,
  root?: string
): Promise<CarryReport> {
  // Every destination here is relative and cannot climb out: `carriedFiles` is
  // what guarantees it, so nothing below has to check again.
  const list = carriedFiles(await readCarryList(projectId, root))
  const written: string[] = []
  const missing: string[] = []

  for (const { path, from: source } of list) {
    const from = sourcePath(source, repoPath, path)
    const to = join(workspacePath, path)

    // Before the mkdir, which creates the intermediate directories itself — a
    // check after it cannot tell one git checked out from one this call just
    // made. Skipped rather than refused, like every other bad line here.
    if (!(await unlinkedInside(workspacePath, path))) {
      missing.push(path)
      continue
    }

    try {
      await mkdir(dirname(to), { recursive: true })
      await copyFile(from, to, constants.COPYFILE_EXCL)
      written.push(path)
    } catch (error) {
      if (!alreadyThere(error)) missing.push(path)
    }
  }

  return { written, missing }
}
