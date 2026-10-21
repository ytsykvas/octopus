import { describe, expect, it } from 'vitest'

import { buildTree, listingNodes, type TreeEntry } from '@core/fileTree.js'

import {
  filterFiles,
  type ListingState,
  MAX_FILTER_RESULTS,
  revealPath,
  visibleRows
} from './treeRows.js'

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

  it('stands a note in for an ignored folder whose listing is not in yet', () => {
    const open = new Set(['node_modules'])

    expect(drawn(visibleRows(tree, open, NO_LISTINGS)).slice(0, 2)).toEqual([
      'node_modules/',
      '  (loading)'
    ])
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

describe('filterFiles', () => {
  it('ranks the files of the tree, folders left out', () => {
    expect(filterFiles(tree, 'b').matches.map((node) => node.path)).toEqual(['src/core/b.ts'])
    expect(filterFiles(tree, 'src').matches.map((node) => node.path)).toEqual([
      'src/a.ts',
      'src/core/b.ts'
    ])
  })

  it('finds the files of a folder read from disk', () => {
    const merged = new Map(tree)
    merged.set(
      'node_modules',
      listingNodes(
        { path: 'node_modules', ignored: true },
        { entries: [{ name: 'pkg.js', kind: 'file' }], truncated: false }
      )
    )

    expect(filterFiles(merged, 'pkg').matches).toEqual([
      {
        name: 'pkg.js',
        path: 'node_modules/pkg.js',
        kind: 'file',
        ignored: true,
        childrenFromDisk: false
      }
    ])
  })

  const files = (count: number): ReturnType<typeof buildTree> =>
    buildTree(
      Array.from({ length: count }, (_, index) => ({
        path: `f${String(index)}.ts`,
        kind: 'file' as const,
        ignored: false
      }))
    )

  it('stops at its cap, and says so', () => {
    const found = filterFiles(files(MAX_FILTER_RESULTS + 5), 'f')

    expect(found.capped).toBe(true)
    expect(found.matches).toHaveLength(MAX_FILTER_RESULTS)
  })

  // Exactly as many as it holds is the whole answer, not a cut one.
  it('does not call a list of exactly the cap cut short', () => {
    expect(filterFiles(files(MAX_FILTER_RESULTS), 'f')).toMatchObject({ capped: false })
  })
})

describe('revealPath', () => {
  it('opens the folders above a file, outermost first', () => {
    expect(revealPath(tree, 'src/core/b.ts')).toEqual({ open: ['src', 'src/core'], fromDisk: [] })
    expect(revealPath(tree, 'README.md')).toEqual({ open: [], fromDisk: [] })
  })

  // `node_modules/pkg` is not in the tree until `node_modules` is read.
  it('reads every folder from the first one read from disk down', () => {
    expect(revealPath(tree, 'node_modules/pkg/lib/x.js')).toEqual({
      open: ['node_modules', 'node_modules/pkg', 'node_modules/pkg/lib'],
      fromDisk: ['node_modules', 'node_modules/pkg', 'node_modules/pkg/lib']
    })
  })
})
