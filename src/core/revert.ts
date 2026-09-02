/**
 * Putting one file back to the state the workspace branched from.
 *
 * Beside `diff.ts` rather than inside it. That module opens by promising that
 * nothing in it writes — "a review pane that modified the repository it is
 * reporting on would change the answer by asking the question" — and the
 * promise is worth more than the import it saves. This is the module that
 * writes; it borrows the left-hand side from that one and nothing else.
 *
 * **The scope is the pane's scope.** The diff is measured against the merge
 * base, so it draws committed work alongside staged and unstaged, and a revert
 * that undid less than the pane showed would leave a row behind and read as a
 * button that did not work. Afterwards the file is what it was at the base and
 * its row is gone.
 *
 * Committed work is not lost by this: the commits stand, and what is written
 * is a new change in the working tree that undoes them. Uncommitted work is,
 * and nothing in git holds a copy of it — which is what the dialog in front of
 * this has to say.
 */

import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { mergeBase } from './diff.js'
import type { GitExec } from './git.js'
import { insideWorktree } from './paths.js'

export interface RevertOptions {
  /** Resolved to the merge base, exactly as the diff read resolves it. */
  readonly baseBranch: string
  /** The worktree root, for the one case that is a plain file deletion. */
  readonly root: string
  /** The path as the diff reports it now. */
  readonly path: string
  /** Where it came from when it moved or was copied; both ends are put back. */
  readonly oldPath?: string | null
}

/**
 * A path as accepted from the renderer.
 *
 * Bounded as well as checked: it becomes a process argument, and a path longer
 * than any filesystem allows is not one the pane could have drawn.
 */
export const RevertPathSchema = z.string().min(1).max(4_096).refine(insideWorktree, {
  message: 'a path must stay inside the workspace'
})

/** Whether the base commit had this path at all. */
async function existedAtBase(exec: GitExec, base: string, path: string): Promise<boolean> {
  try {
    await exec(['cat-file', '-e', `${base}:${path}`])
    return true
  } catch {
    // `cat-file -e` answers by exit status, and the only question asked of it
    // is this one — a path git cannot resolve at that commit is a path that
    // was not there.
    return false
  }
}

/** Whether git is tracking this path now. */
async function tracked(exec: GitExec, path: string): Promise<boolean> {
  return (await exec(['ls-files', '-z', '--', `:(literal)${path}`])) !== ''
}

/**
 * Puts one path back, whatever it is doing now.
 *
 * Two questions to git, and the answers decide — rather than a `switch` on the
 * `FileStatus` the diff reported. Rename and copy detection are heuristics, and
 * a status that guessed wrong would send a file down the wrong branch; what the
 * base commit holds and what the index holds cannot be wrong about the
 * repository they are asked of.
 *
 * `--` before every path, so one beginning with `-` is an argument rather than
 * a flag, and `:(literal)` on every pathspec, so one containing `[`, `*` or `?`
 * is a name rather than a pattern. Both are needed and neither replaces the
 * other: `app/[slug]/page.tsx` is an ordinary Next.js route, and as a pattern
 * it matches its neighbours — which `checkout` would restore over their
 * uncommitted work and `rm` would delete outright. `diff.ts` says the same of
 * the reading side, above `attachHunks`.
 *
 * `existedAtBase` is deliberately not given the prefix: `<rev>:<path>` is git's
 * object syntax rather than a pathspec, and does not glob.
 */
async function revertPath(exec: GitExec, base: string, root: string, path: string): Promise<void> {
  if (await existedAtBase(exec, base, path)) {
    // Restores the content and stages it, which is right: the workspace's next
    // commit should carry the file as the base had it.
    await exec(['checkout', base, '--', `:(literal)${path}`])
    return
  }

  if (await tracked(exec, path)) {
    // `-f` because the point is to discard: without it git refuses a file
    // whose contents differ from the index, which is most of them here.
    await exec(['rm', '-f', '--', `:(literal)${path}`])
    return
  }

  // Untracked, so git has no record to undo — the file simply goes.
  try {
    await unlink(join(root, path))
  } catch {
    // Already gone. Somebody deleting a file between the pane being drawn and
    // the button being pressed has arrived at the same place by another road.
  }
}

/**
 * Reverts one file of a workspace's diff.
 *
 * Both ends of a rename are named, because a rename is one row in the pane and
 * two paths on disk: the old one has to come back and the new one has to go,
 * and doing only the first leaves the file present twice.
 */
export async function revertFile(exec: GitExec, options: RevertOptions): Promise<void> {
  const paths = [options.path, ...(options.oldPath != null ? [options.oldPath] : [])]

  for (const path of paths) {
    if (!insideWorktree(path)) {
      throw new Error(`refusing to revert ${path}: it is not inside the workspace`)
    }
  }

  const base = await mergeBase(exec, options.baseBranch)

  // In order rather than at once. A rename's two paths can be the same file on
  // a case-insensitive filesystem, and two writes racing over one path is a
  // result nobody can predict.
  for (const path of paths) {
    await revertPath(exec, base, options.root, path)
  }
}
