import { describe, expect, it } from 'vitest'

import { buildTree, listingNodes, type TreeEntry } from '@core/fileTree.js'

import { type ListingState, visibleRows } from './treeRows.js'

const ENTRIES: TreeEntry[] = [
  { path: 'src/a.ts', kind: 'file', ignored: false },
  { path: 'src/core/b.ts', kind: 'file', ignored: false },
  { path: 'README.md', kind: 'file', ignored: false },
  { path: 'node_modules', kind: 'directory', ignored: true }
]

const tree = buildTree(ENTRIES)
const NO_LISTINGS: ReadonlyMap<string, ListingState> = new Map()

/** Each row as a short line, so a test reads as the tree it draws. */
const drawn = (rows: ReturnType<typeof visibleRows>): string[] =>
  rows.map((row) =>
    row.type === 'note'
      ? `${'  '.repeat(row.level - 1)}(${row.note})`
      : `${'  '.repeat(row.level - 1)}${row.node.name}${row.expanded ? '/' : ''}`
  )

describe('visibleRows', () => {
  it('draws only the top level while everything is closed', () => {
    expect(drawn(visibleRows(tree, new Set(), NO_LISTINGS))).toEqual([
      'node_modules',
      'src',
      'README.md'
    ])
  })

  it('walks into open folders, and only those', () => {
    const rows = visibleRows(tree, new Set(['src', 'src/core']), NO_LISTINGS)

    expect(drawn(rows)).toEqual([
      'node_modules',
      'src/',
      '  core/',
      '    b.ts',
      '  a.ts',
      'README.md'
    ])
  })

  // `aria-setsize` and `aria-posinset` are what tell a reader "2 of 3".
  it('numbers each row within its own folder, from one', () => {
    const rows = visibleRows(tree, new Set(['src']), NO_LISTINGS)
    const core = rows.find((row) => row.type === 'node' && row.node.name === 'core')

    expect(core).toMatchObject({ level: 2, setSize: 2, position: 1 })
    expect(rows[0]).toMatchObject({ level: 1, setSize: 3, position: 1 })
  })

  it('stands a note in for an ignored folder not read yet, or still being read', () => {
    const open = new Set(['node_modules'])

    expect(drawn(visibleRows(tree, open, NO_LISTINGS)).slice(0, 2)).toEqual([
      'node_modules/',
      '  (loading)'
    ])
    expect(
      drawn(visibleRows(tree, open, new Map([['node_modules', { status: 'loading' }]]))).slice(0, 2)
    ).toEqual(['node_modules/', '  (loading)'])
  })

  // Read from disk like an ignored folder, though nothing about it is ignored.
  it('stands the same note in for a submodule not read yet', () => {
    const withSubmodule = buildTree([{ path: 'vendor', kind: 'directory', ignored: false }])

    expect(drawn(visibleRows(withSubmodule, new Set(['vendor']), NO_LISTINGS))).toEqual([
      'vendor/',
      '  (loading)'
    ])
  })

  it('says when an ignored folder could not be read', () => {
    const rows = visibleRows(
      tree,
      new Set(['node_modules']),
      new Map([['node_modules', { status: 'failed' }]])
    )

    expect(drawn(rows).slice(0, 2)).toEqual(['node_modules/', '  (failed)'])
  })

  it('draws a read folder, and says when its listing was cut short', () => {
    const merged = new Map(tree)
    merged.set(
      'node_modules',
      listingNodes(
        { path: 'node_modules', ignored: true },
        { entries: [{ name: 'pkg', kind: 'directory' }], truncated: true }
      )
    )

    const rows = visibleRows(
      merged,
      new Set(['node_modules']),
      new Map([['node_modules', { status: 'ready', truncated: true }]])
    )

    expect(drawn(rows).slice(0, 3)).toEqual(['node_modules/', '  pkg', '  (truncated)'])
  })

  /*
   * A submodule never checked out in this worktree — which `git worktree add`
   * leaves every one of — is an empty folder, and it opened onto nothing: no
   * row and no note, which reads as still loading or as broken. The two
   * arguments are independent, so a listing marked ready whose rows the index
   * does not carry says the same rather than throwing.
   */
  it('says so under a read folder with nothing in it', () => {
    const merged = new Map(tree)
    merged.set('node_modules', [])

    for (const index of [tree, merged]) {
      const rows = visibleRows(
        index,
        new Set(['node_modules']),
        new Map([['node_modules', { status: 'ready', truncated: false }]])
      )

      expect(drawn(rows).slice(0, 3)).toEqual(['node_modules/', '  (empty)', 'src'])
    }
  })

  it('adds no note under a read folder that was listed whole', () => {
    const merged = new Map(tree)
    merged.set(
      'node_modules',
      listingNodes(
        { path: 'node_modules', ignored: true },
        { entries: [{ name: 'pkg', kind: 'file' }], truncated: false }
      )
    )

    const rows = visibleRows(
      merged,
      new Set(['node_modules']),
      new Map([['node_modules', { status: 'ready', truncated: false }]])
    )

    expect(drawn(rows).slice(0, 3)).toEqual(['node_modules/', '  pkg', 'src'])
  })
})
