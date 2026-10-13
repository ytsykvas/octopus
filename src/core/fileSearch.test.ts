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
  it('asks git for tracked and untracked files, and nothing it ignores', async () => {
    const calls: string[][] = []

    await listFiles((args) => {
      calls.push([...args])
      return Promise.resolve('a.ts\0b.ts\0')
    })

    expect(calls).toEqual([['ls-files', '-z', '--cached', '--others', '--exclude-standard']])
  })

  // A path may hold a newline, and splitting on one would make two files of it.
  it('splits on NUL and drops the empty tail and duplicates', async () => {
    const files = await listFiles(() => Promise.resolve('a.ts\0odd\nname.ts\0a.ts\0'))

    expect(files).toEqual(['a.ts', 'odd\nname.ts'])
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
