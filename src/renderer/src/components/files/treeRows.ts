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

  // A folder read from disk — ignored, or a submodule — may not be read yet.
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
