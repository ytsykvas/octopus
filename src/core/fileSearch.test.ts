import { describe, expect, it } from 'vitest'

import { listFiles, MAX_MENTION_RESULTS, rankFiles } from './fileSearch.js'

const FILES = [
  'README.md',
  'src/core/service.ts',
  'src/core/service.test.ts',
  'src/renderer/src/components/chat/Composer.tsx',
  'src/renderer/src/components/chat/ComposerAttic.tsx',
  'docs/ui.md'
]

describe('listing the files of a worktree', () => {
  const blob = (path: string, stage = 0): string =>
    `100644 a09ef9334a022405ac5f08b981bdaa1d5c194e8c ${String(stage)}\t${path}`

  const answering =
    (staged: string[], others: string[]) =>
    (args: readonly string[]): Promise<string> =>
      Promise.resolve([...(args.includes('--stage') ? staged : others), ''].join('\0'))

  it('asks git for the tracked files with their modes, and the untracked it does not ignore', async () => {
    const calls: string[][] = []

    await listFiles((args) => {
      calls.push([...args])
      return Promise.resolve('')
    })

    expect(calls).toEqual([
      ['ls-files', '-z', '--stage'],
      ['ls-files', '-z', '--others', '--exclude-standard']
    ])
  })

  // A path may hold a newline, and splitting on one would make two files of it;
  // a conflicted path is in the index once per stage.
  it('splits on NUL, and lists a conflicted path once', async () => {
    const files = await listFiles(
      answering([blob('a.ts', 1), blob('a.ts', 2), blob('odd\nname.ts')], ['new.ts'])
    )

    expect(files).toEqual(['a.ts', 'odd\nname.ts', 'new.ts'])
  })

  // Either is a folder, and picked from the list it attached a folder's path
  // as a file.
  it('leaves out a submodule and a repository nested in the worktree', async () => {
    const files = await listFiles(
      answering(
        [blob('a.ts'), '160000 a16a57ce22daca2d5424b4ba00748ef1f06fb2fe 0\tlib/inner'],
        ['nested/', 'b.ts']
      )
    )

    expect(files).toEqual(['a.ts', 'b.ts'])
  })
})

describe('ranking files for a mention', () => {
  it('puts the file called exactly that first', () => {
    expect(rankFiles(FILES, 'service.ts')[0]).toBe('src/core/service.ts')
  })

  it('prefers a name that starts with the query to one that merely contains it', () => {
    expect(rankFiles(FILES, 'comp')).toEqual([
      'src/renderer/src/components/chat/Composer.tsx',
      'src/renderer/src/components/chat/ComposerAttic.tsx'
    ])
  })

  // The middle tier: the name holds it, but not at the start.
  it('finds a name that merely contains the letters', () => {
    expect(rankFiles(FILES, 'ervice')[0]).toBe('src/core/service.ts')
  })

  it('finds a file by its directory when the name does not say', () => {
    expect(rankFiles(FILES, 'docs')[0]).toBe('docs/ui.md')
  })

  it('finds letters in order, which is what a half-remembered name is', () => {
    expect(rankFiles(FILES, 'cmpser')).toEqual([
      'src/renderer/src/components/chat/Composer.tsx',
      'src/renderer/src/components/chat/ComposerAttic.tsx'
    ])
  })

  it('ignores case in the query and in the path', () => {
    expect(rankFiles(FILES, 'README')).toEqual(['README.md'])
    expect(rankFiles(FILES, 'readme')).toEqual(['README.md'])
  })

  it('offers nothing for letters that are not there in order', () => {
    expect(rankFiles(FILES, 'zzz')).toEqual([])
  })

  it('offers the shortest paths for an empty query', () => {
    expect(rankFiles(FILES, '', 2)).toEqual(['README.md', 'docs/ui.md'])
  })

  // The same query must answer in the same order, or the list shuffles under
  // the caret while somebody is reading it.
  it('breaks ties by length and then by name', () => {
    expect(rankFiles(['b/x.ts', 'a/x.ts', 'long/dir/x.ts'], 'x.ts')).toEqual([
      'a/x.ts',
      'b/x.ts',
      'long/dir/x.ts'
    ])
  })

  it('stops at the limit', () => {
    const many = Array.from({ length: 30 }, (_unused, index) => `file-${String(index)}.ts`)

    expect(rankFiles(many, 'file')).toHaveLength(MAX_MENTION_RESULTS)
    expect(rankFiles(many, 'file', 3)).toHaveLength(3)
  })
})
