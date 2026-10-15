/**
 * Reading a workspace's files for the window to show — a folder's entries and
 * a file's contents.
 *
 * Both arrive with a path from the renderer, which draws agent output, so both
 * go through `fileInWorkspace` before touching the disk: a symlink an agent
 * left in the worktree can point anywhere, and following it would put a file
 * from outside the workspace on screen as though it were part of it.
 */

import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { looksBinary } from './diff.js'
import {
  compareNodes,
  type DirectoryEntry,
  type DirectoryListing,
  HIDDEN_NAMES,
  type TreeEntryKind
} from './fileTree.js'
import type { GitExec } from './git.js'
import { insideWorktree } from './paths.js'
import type { Workspace } from './store.js'
import { fileInWorkspace, WorkspaceError } from './workspaces.js'

/**
 * Past this a folder stops listing.
 *
 * `node_modules/.pnpm` runs to thousands of entries, and nobody scrolls a
 * folder that long looking for something — they would search.
 */
export const MAX_DIRECTORY_ENTRIES = 5_000

/**
 * The largest file the viewer is sent.
 *
 * Checked before the read, not after: the point is not to pull a 200 MB log
 * across IPC to then decline to draw it. The same scale as the diff's own
 * whole-file cap.
 */
export const MAX_VIEW_BYTES = 1_000_000

/**
 * What the viewer is given for a path.
 *
 * `missing` covers both a file that is gone and one outside the worktree,
 * deliberately: the window has no use for the difference, and a distinct
 * answer for "exists, but somewhere you may not look" would say something
 * about the disk beyond the workspace.
 *
 * `deleted` is a file gone from disk that HEAD still has — what was there, so a
 * deletion in the tree opens onto something. `text` is null when that version
 * is binary or too large to show.
 */
export type FileContent =
  | { readonly kind: 'text'; readonly text: string; readonly bytes: number }
  | { readonly kind: 'binary'; readonly bytes: number }
  | { readonly kind: 'tooLarge'; readonly bytes: number; readonly limit: number }
  | { readonly kind: 'missing' }
  | { readonly kind: 'deleted'; readonly text: string | null }

/**
 * The kind of one entry, following a link to learn it.
 *
 * Followed only to choose the icon and whether a chevron is drawn. Opening it
 * goes back through `fileInWorkspace`, which is where a link pointing out of
 * the worktree is refused; a link pointing at nothing is drawn as a file.
 */
async function kindOf(folder: string, name: string, linked: boolean): Promise<TreeEntryKind> {
  if (!linked) return 'file'

  try {
    return (await stat(join(folder, name))).isDirectory() ? 'directory' : 'file'
  } catch {
    return 'file'
  }
}

/**
 * The entries of a folder inside the workspace, read from disk.
 *
 * Asked only of folders git ignores whole — everything else the tree already
 * has from git — which is why this walks the disk rather than asking git: git
 * has nothing to say about the inside of `node_modules`.
 */
export async function readWorkspaceDirectory(
  workspace: Workspace,
  path: string
): Promise<DirectoryListing> {
  const real = await fileInWorkspace(workspace, path)

  if (real === null || !(await stat(real)).isDirectory()) {
    throw new WorkspaceError(
      'worktreeMissing',
      { workspaceId: workspace.id, path },
      `Folder ${path} is not inside workspace ${workspace.id}.`
    )
  }

  const found = await readdir(real, { withFileTypes: true })
  const entries: DirectoryEntry[] = await Promise.all(
    found
      .filter((entry) => !HIDDEN_NAMES.has(entry.name))
      .map(async (entry) => ({
        name: entry.name,
        kind: entry.isDirectory()
          ? 'directory'
          : await kindOf(real, entry.name, entry.isSymbolicLink())
      }))
  )

  entries.sort(compareNodes)

  return entries.length > MAX_DIRECTORY_ENTRIES
    ? { entries: entries.slice(0, MAX_DIRECTORY_ENTRIES), truncated: true }
    : { entries, truncated: false }
}

/** Whether nothing at all is at a path — not even a dangling link. */
async function absent(root: string, path: string): Promise<boolean> {
  try {
    await lstat(join(root, path))
    return false
  } catch {
    return true
  }
}

/**
 * The version HEAD holds of a file that is gone from disk.
 *
 * `ls-tree` first, for the object's type and size, so a folder or a submodule
 * is not mistaken for a file and an enormous blob is declined before it is
 * read. `ls-tree` matches its paths literally — no globbing — so a file called
 * `*.ts` names itself and nothing else; the test pins it.
 *
 * Null when HEAD has no such file — the repository has no commits, the path was
 * never committed, or it is not a regular blob.
 */
async function committed(exec: GitExec, path: string): Promise<FileContent | null> {
  let listing: string
  try {
    listing = await exec(['ls-tree', '-l', '-z', 'HEAD', '--', path])
  } catch {
    // No HEAD yet. There is no earlier version to show, which is an answer.
    return null
  }

  // `<mode> <type> <object> <size>\t<path>`, the size padded with spaces.
  const [record = ''] = listing.split('\0')
  const [head = '', listed] = record.split('\t')
  const [, type, object = '', size] = head.split(/\s+/)
  if (listed !== path || type !== 'blob') return null

  if (Number(size) > MAX_VIEW_BYTES) return { kind: 'deleted', text: null }

  const text = await exec(['cat-file', 'blob', object])
  return { kind: 'deleted', text: text.slice(0, BINARY_SNIFF_CHARS).includes('\0') ? null : text }
}

/** git's own rule for binary, the same window `looksBinary` reads. */
const BINARY_SNIFF_CHARS = 8_000

/**
 * A file of the workspace, for the viewer.
 *
 * The order of the checks is the point: containment, then that it is a file,
 * then its size — all before a byte is read.
 */
export async function readWorkspaceFile(
  workspace: Workspace,
  path: string,
  exec: GitExec
): Promise<FileContent> {
  const real = await fileInWorkspace(workspace, path)

  if (real === null) {
    /*
     * `fileInWorkspace` cannot vouch for something that is not there, so the
     * string is checked on its own before it reaches git — and only a path
     * with nothing at all on disk is treated as deleted. A link pointing out of
     * the worktree is also null above, and is not a deletion.
     */
    if (!insideWorktree(path) || !(await absent(workspace.path, path))) return { kind: 'missing' }
    return (await committed(exec, path)) ?? { kind: 'missing' }
  }

  const facts = await stat(real)
  if (!facts.isFile()) return { kind: 'missing' }
  if (facts.size > MAX_VIEW_BYTES) {
    return { kind: 'tooLarge', bytes: facts.size, limit: MAX_VIEW_BYTES }
  }

  const bytes = await readFile(real)
  if (looksBinary(bytes)) return { kind: 'binary', bytes: bytes.length }

  // `TextDecoder` drops a byte-order mark, which would otherwise draw as a
  // stray character at the start of the first line.
  return { kind: 'text', text: new TextDecoder().decode(bytes), bytes: bytes.length }
}
