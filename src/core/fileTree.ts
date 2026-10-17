import type { FileStatus } from './diff.js'
import { listFiles } from './fileSearch.js'
import type { GitExec } from './git.js'

/**
 * The file tree of a workspace, as the right pane's Files tab draws it.
 *
 * Pure apart from the one reader at the bottom, which takes its executor as a
 * parameter — so this module pulls in nothing Node-only and the window may
 * import its values (the first table in docs/core.md). The tree is built here
 * rather than in the window because the parsing is where git's output turns
 * out to be stranger than expected, and that is worth testing on strings.
 */

/**
 * What git says about a path, measured against HEAD.
 *
 * HEAD rather than the base branch the Changes tab compares with: the tree
 * answers "what have I not committed yet", which is what an editor's explorer
 * means by a mark, while the Changes tab answers "what will this branch
 * deliver". After a commit the two disagree, and both are right.
 *
 * `conflicted` is the one state the diff has no word for, because a diff
 * against a merge base never sees an unmerged index.
 */
export type TreeStatus = FileStatus | 'conflicted'

export type TreeEntryKind = 'file' | 'directory'

/**
 * One path the tree knows about.
 *
 * `directory` is only ever an ignored folder git reported whole — every other
 * folder is implied by the files under it, which is how git lists them.
 */
export interface TreeEntry {
  readonly path: string
  readonly kind: TreeEntryKind
  readonly ignored: boolean
}

/**
 * Everything the tree needs from one read, kept flat.
 *
 * Flat rather than nested because folders read later — an ignored one being
 * expanded — have to merge into it, and a map from folder to children is
 * where that merge is one `set`.
 */
export interface FileTreeSnapshot {
  readonly entries: readonly TreeEntry[]
  readonly statuses: Readonly<Record<string, TreeStatus>>
  /** The list was cut at `MAX_TREE_ENTRIES`; the window says so. */
  readonly truncated: boolean
}

/** One entry of a folder read from disk, for an ignored folder being opened. */
export interface DirectoryEntry {
  readonly name: string
  readonly kind: TreeEntryKind
}

export interface DirectoryListing {
  readonly entries: readonly DirectoryEntry[]
  readonly truncated: boolean
}

/** A row of the tree, before it is decided whether it is shown. */
export interface TreeNode {
  readonly name: string
  readonly path: string
  readonly kind: TreeEntryKind
  readonly ignored: boolean
}

/**
 * Children by the path of their folder; the root is `''`.
 *
 * Folder-keyed so that drawing only the open folders never walks a closed one,
 * and an ignored folder read later is one more key.
 */
export type TreeIndex = ReadonlyMap<string, readonly TreeNode[]>

/**
 * Past this the tree stops listing.
 *
 * A repository with more files than this is one nobody browses by scrolling,
 * and the payload crosses IPC on every turn the tab is open.
 */
export const MAX_TREE_ENTRIES = 50_000

/**
 * Past this a folder read from disk stops listing.
 *
 * `node_modules/.pnpm` runs to thousands of entries, and nobody scrolls a
 * folder that long looking for something — they would search. Here rather than
 * beside the reader so the window can say the number in its notice.
 */
export const MAX_DIRECTORY_ENTRIES = 5_000

/**
 * Names the tree never shows, at any depth.
 *
 * VS Code's own `files.exclude` defaults. `.git` is the one that matters: it
 * is a file in a worktree, a folder in a checkout, and in neither case
 * something to read as part of the project.
 */
export const HIDDEN_NAMES: ReadonlySet<string> = new Set(['.git', '.DS_Store', 'Thumbs.db'])

/** The status codes git uses for an unmerged path (`git status` docs). */
const CONFLICTS = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

/**
 * One path's two-letter code as a single state.
 *
 * One mark per file, so the index and the worktree are folded together the way
 * an editor does: a file staged and then edited again is simply modified.
 * The order is what decides a mixed code — `AD`, added and then deleted from
 * disk, is a file that is not there, so deletion wins.
 */
function statusOf(code: string): TreeStatus {
  if (code === '??') return 'untracked'
  if (CONFLICTS.has(code)) return 'conflicted'

  const [index = ' ', tree = ' '] = code
  if (index === 'D' || tree === 'D') return 'deleted'
  // A rename in the worktree column too: `git add -N` on a moved file makes
  // git pair the two paths without anything staged, and reports ` R`.
  if (index === 'R' || tree === 'R') return 'renamed'
  if (index === 'C' || tree === 'C') return 'copied'
  if (index === 'A') return 'added'
  if (index === 'T' || tree === 'T') return 'typeChanged'
  return 'modified'
}

/**
 * Reads `git status --porcelain=v1 -z`.
 *
 * Each record is `XY path`, NUL-terminated, with no quoting under `-z`. A
 * rename or a copy — in either column — carries a second record holding the
 * path it came from —
 * after the new one, which is the opposite of the arrow git prints without
 * `-z` — and that second record is skipped: the old path is not on disk, so
 * there is no row to mark.
 */
export function parseStatus(output: string): {
  statuses: Record<string, TreeStatus>
  /** The old sides of renames — paths the index may still list, gone from disk. */
  movedAway: string[]
} {
  const statuses: Record<string, TreeStatus> = {}
  const movedAway: string[] = []
  // One iterator, advanced by hand past the second record of a rename.
  const records = output.split('\0').values()

  for (const record of records) {
    if (record.length < 4) continue

    const code = record.slice(0, 2)
    statuses[record.slice(3)] = statusOf(code)

    if (!/[RC]/.test(code)) continue
    const from = records.next()
    // A copy's source is still there; a rename's is not.
    if (code.includes('R') && from.done !== true) movedAway.push(from.value)
  }

  return { statuses, movedAway }
}

/**
 * Reads `git ls-files --others --ignored --exclude-standard --directory -z`.
 *
 * `--directory` is what keeps `node_modules` one entry rather than a hundred
 * thousand: a folder ignored whole comes back as `name/`, and is read from
 * disk only if somebody opens it.
 */
export function parseIgnored(output: string): TreeEntry[] {
  return output
    .split('\0')
    .filter((path) => path !== '')
    .map((path) =>
      path.endsWith('/')
        ? { path: path.slice(0, -1), kind: 'directory', ignored: true }
        : { path, kind: 'file', ignored: true }
    )
}

function hidden(path: string): boolean {
  return path.split('/').some((segment) => HIDDEN_NAMES.has(segment))
}

/**
 * The paths the tree shows, from the three listings.
 *
 * Deleted files are kept, to be drawn struck through: a deletion is work as
 * much as an edit is. Git lists them unevenly — a file removed from disk is
 * still in the index and so in `ls-files --cached`, while one removed with
 * `git rm` is in neither listing and appears only in the status — so every
 * path the status names is added if the listings missed it.
 */
export function collectTreeEntries(
  listed: readonly string[],
  ignored: readonly TreeEntry[],
  statuses: Readonly<Record<string, TreeStatus>>,
  movedAway: readonly string[] = []
): { entries: TreeEntry[]; truncated: boolean } {
  // The old side of a rename found in the worktree (` R`, after `git add -N`)
  // is still in the index and so in `ls-files --cached`, though not on disk.
  const seen = new Set<string>(movedAway)
  const entries: TreeEntry[] = []

  const add = (entry: TreeEntry): void => {
    if (seen.has(entry.path) || hidden(entry.path)) return
    seen.add(entry.path)
    entries.push(entry)
  }

  for (const path of listed) add({ path, kind: 'file', ignored: false })
  for (const path of Object.keys(statuses)) add({ path, kind: 'file', ignored: false })
  for (const entry of ignored) add(entry)

  return entries.length > MAX_TREE_ENTRIES
    ? { entries: entries.slice(0, MAX_TREE_ENTRIES), truncated: true }
    : { entries, truncated: false }
}

/**
 * The order of a folder's children: folders first, then by name as a person
 * reads it — `file2` before `file10`, case set aside.
 *
 * The plain comparison at the end only breaks a tie the collation calls equal
 * (`a.ts` and `A.ts` on a case-sensitive disk), so the order never depends on
 * the order the listing arrived in.
 */
export function compareNodes(
  a: { readonly name: string; readonly kind: TreeEntryKind },
  b: { readonly name: string; readonly kind: TreeEntryKind }
): number {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1

  const collated = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  if (collated !== 0) return collated
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * The tree, as children by folder.
 *
 * Folders that are only implied — `src` in `src/main.ts` — are created on the
 * way down and are not ignored, even when everything inside them is: a folder
 * is greyed only when git ignores the folder itself.
 */
export function buildTree(entries: readonly TreeEntry[]): Map<string, TreeNode[]> {
  const children = new Map<string, Map<string, TreeNode>>([['', new Map()]])

  const folder = (path: string): Map<string, TreeNode> => {
    let held = children.get(path)
    if (held === undefined) {
      held = new Map()
      children.set(path, held)
    }
    return held
  }

  const place = (node: TreeNode): void => {
    const siblings = folder(parentOf(node.path))
    const existing = siblings.get(node.name)
    // Met twice only as a folder — the listings never name one file twice. A
    // folder that holds tracked files is not ignored, whichever listing named
    // it first.
    if (existing === undefined) siblings.set(node.name, node)
    else siblings.set(node.name, { ...existing, ignored: existing.ignored && node.ignored })
  }

  for (const entry of entries) {
    const segments = entry.path.split('/')
    for (let depth = 1; depth < segments.length; depth++) {
      const path = segments.slice(0, depth).join('/')
      place({ name: nameOf(path), path, kind: 'directory', ignored: false })
      folder(path)
    }

    place({ name: nameOf(entry.path), path: entry.path, kind: entry.kind, ignored: entry.ignored })
  }

  return new Map(
    [...children].map(([path, siblings]) => [path, [...siblings.values()].sort(compareNodes)])
  )
}

/**
 * A folder read from disk, as rows of the tree.
 *
 * Everything in it is ignored: the only folders read this way are ones git
 * reported ignored whole, and what lies inside an ignored folder is ignored
 * with it.
 */
export function listingNodes(folder: string, listing: DirectoryListing): TreeNode[] {
  return listing.entries
    .map((entry) => ({
      name: entry.name,
      path: folder === '' ? entry.name : `${folder}/${entry.name}`,
      kind: entry.kind,
      ignored: true
    }))
    .sort(compareNodes)
}

/**
 * How strongly a status asks to be seen, for the dot on a folder.
 *
 * A conflict stops work, an edit is the ordinary case, a deletion is rarer and
 * a new file is the quietest — it shows in its own colour on its own row.
 */
const WEIGHT: Record<TreeStatus, number> = {
  conflicted: 4,
  modified: 3,
  renamed: 3,
  copied: 3,
  typeChanged: 3,
  deleted: 2,
  added: 1,
  untracked: 1
}

/**
 * Each folder's strongest status below it.
 *
 * What lets a collapsed folder say there is work inside, the way an editor
 * colours the folder of a changed file. Deletions count, since a folder whose
 * only change is a removed file has still changed.
 */
export function folderStatuses(
  statuses: Readonly<Record<string, TreeStatus>>
): Record<string, TreeStatus> {
  const folders: Record<string, TreeStatus> = {}

  for (const [path, status] of Object.entries(statuses)) {
    for (let folder = parentOf(path); folder !== ''; folder = parentOf(folder)) {
      const held = folders[folder]
      if (held === undefined || WEIGHT[status] > WEIGHT[held]) folders[folder] = status
    }
  }

  return folders
}

/**
 * Reads the tree of a worktree in one go.
 *
 * `--no-optional-locks` on the status: without it `git status` refreshes the
 * index and takes `index.lock` to write it back, and the agent runs its own git
 * in this same worktree — the two would trip over each other's lock.
 *
 * `Promise.all` rather than `allOf`: `parallel.ts` reaches `node:util`, and
 * this module is one the window imports values from. Which of three git reads
 * failed first is not something anybody acts on here.
 */
export async function readFileTree(exec: GitExec): Promise<FileTreeSnapshot> {
  const [status, listed, ignored] = await Promise.all([
    exec(['--no-optional-locks', 'status', '--porcelain=v1', '-z', '-uall']),
    listFiles(exec),
    exec(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'])
  ])

  const { statuses, movedAway } = parseStatus(status)
  const { entries, truncated } = collectTreeEntries(
    listed,
    parseIgnored(ignored),
    statuses,
    movedAway
  )

  return { entries, statuses, truncated }
}
