import { rankFiles } from '@core/fileSearch.js'
import type { TreeIndex, TreeNode } from '@core/fileTree.js'

/**
 * Where reading a folder from disk has got to. Absent from the map means it was
 * never asked for, which reads the same as `loading`: an expanded folder asks
 * the moment it is opened.
 */
export type ListingState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly truncated: boolean }

/**
 * One line of the tree as drawn: an entry, or a note standing in for the
 * contents of a folder that has none to show yet.
 *
 * Notes are rows rather than decorations on their folder so that they scroll,
 * indent and virtualise exactly like the entries around them.
 */
export type TreeRow =
  | {
      readonly type: 'node'
      readonly node: TreeNode
      readonly level: number
      readonly setSize: number
      readonly position: number
      readonly expanded: boolean
    }
  | {
      readonly type: 'note'
      readonly key: string
      readonly level: number
      readonly note: 'loading' | 'failed' | 'truncated' | 'empty'
    }

/**
 * The rows of the open part of the tree, top to bottom.
 *
 * Only the expanded folders are walked, so the cost follows what is on screen
 * rather than the size of the repository. `level` is one-based, as
 * `aria-level` is.
 */
export function visibleRows(
  index: TreeIndex,
  expanded: ReadonlySet<string>,
  listings: ReadonlyMap<string, ListingState>
): TreeRow[] {
  const rows: TreeRow[] = []

  const walk = (folder: string, level: number): void => {
    const children = index.get(folder) ?? []

    children.forEach((node, position) => {
      const open = node.kind === 'directory' && expanded.has(node.path)
      rows.push({
        type: 'node',
        node,
        level,
        setSize: children.length,
        position: position + 1,
        expanded: open
      })
      if (open) inside(node, level + 1)
    })
  }

  // A folder read from disk — ignored, a submodule, a nested repository — may
  // not be read yet.
  const inside = (node: TreeNode, level: number): void => {
    if (!node.childrenFromDisk) {
      walk(node.path, level)
      return
    }

    const listing = listings.get(node.path) ?? { status: 'loading' }
    if (listing.status !== 'ready') {
      rows.push({ type: 'note', key: `${node.path}\0note`, level, note: listing.status })
      return
    }

    const before = rows.length
    walk(node.path, level)

    // Most often a submodule never checked out here: with no row under it, the
    // open folder read as still loading, or as broken.
    if (rows.length === before) {
      rows.push({ type: 'note', key: `${node.path}\0note`, level, note: 'empty' })
      return
    }
    if (listing.truncated) {
      rows.push({ type: 'note', key: `${node.path}\0note`, level, note: 'truncated' })
    }
  }

  walk('', 1)
  return rows
}

/** How many files the filter lists; past this the query wants another letter. */
export const MAX_FILTER_RESULTS = 200

/**
 * The files the tree holds that answer a query, best first, and whether more
 * did than the list holds.
 *
 * Ranked by `rankFiles`, the mention list's own order, so `@` and the filter
 * never disagree about what a query means. Every file the tree knows of —
 * git's and those read from disk so far — and nothing it does not: the filter
 * narrows the tree, it does not search the disk. One more than the cap is
 * ranked, so a list of exactly the cap does not claim to be cut short.
 */
export function filterFiles(
  index: TreeIndex,
  query: string
): { readonly matches: TreeNode[]; readonly capped: boolean } {
  const files = new Map<string, TreeNode>()
  for (const children of index.values()) {
    for (const node of children) if (node.kind === 'file') files.set(node.path, node)
  }

  const ranked = rankFiles([...files.keys()], query, MAX_FILTER_RESULTS + 1)
    .map((path) => files.get(path))
    .filter((node) => node !== undefined)

  return {
    matches: ranked.slice(0, MAX_FILTER_RESULTS),
    capped: ranked.length > MAX_FILTER_RESULTS
  }
}

/**
 * The folders to open for `path` to be drawn, outermost first, and which of
 * them have to be read from disk.
 *
 * Read from the first one the tree reads from disk down: every folder inside a
 * folder read from disk is read the same way, and the deeper ones are not in
 * the index until their parent's listing arrives — so they are named here
 * rather than looked up.
 */
export function revealPath(
  index: TreeIndex,
  path: string
): { readonly open: string[]; readonly fromDisk: string[] } {
  const open: string[] = []
  for (let at = path.lastIndexOf('/'); at !== -1; at = path.lastIndexOf('/', at - 1)) {
    open.unshift(path.slice(0, at))
  }

  const nodeAt = (folder: string): TreeNode | undefined => {
    const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : ''
    return index.get(parent)?.find((node) => node.path === folder)
  }
  const first = open.findIndex((folder) => nodeAt(folder)?.childrenFromDisk === true)

  return { open, fromDisk: first === -1 ? [] : open.slice(first) }
}
