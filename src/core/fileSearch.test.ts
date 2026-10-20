import { describe, expect, it } from 'vitest'

import { rankFiles } from './fileSearch.js'

/** Wider than any answer below, so the limit never decides a test it is not about. */
const LIMIT = 10

const FILES = [
  'README.md',
  'src/core/service.ts',
  'src/core/service.test.ts',
  'src/renderer/src/components/chat/Composer.tsx',
  'src/renderer/src/components/chat/ComposerAttic.tsx',
  'docs/ui.md'
]

describe('ranking files for the filter', () => {
  it('puts the file called exactly that first', () => {
    expect(rankFiles(FILES, 'service.ts', LIMIT)[0]).toBe('src/core/service.ts')
  })

  it('prefers a name that starts with the query to one that merely contains it', () => {
    expect(rankFiles(FILES, 'comp', LIMIT)).toEqual([
      'src/renderer/src/components/chat/Composer.tsx',
      'src/renderer/src/components/chat/ComposerAttic.tsx'
    ])
  })

  // The middle tier: the name holds it, but not at the start.
  it('finds a name that merely contains the letters', () => {
    expect(rankFiles(FILES, 'ervice', LIMIT)[0]).toBe('src/core/service.ts')
  })

  it('finds a file by its directory when the name does not say', () => {
    expect(rankFiles(FILES, 'docs', LIMIT)[0]).toBe('docs/ui.md')
  })

  it('finds letters in order, which is what a half-remembered name is', () => {
    expect(rankFiles(FILES, 'cmpser', LIMIT)).toEqual([
      'src/renderer/src/components/chat/Composer.tsx',
      'src/renderer/src/components/chat/ComposerAttic.tsx'
    ])
  })

  it('ignores case in the query and in the path', () => {
    expect(rankFiles(FILES, 'README', LIMIT)).toEqual(['README.md'])
    expect(rankFiles(FILES, 'readme', LIMIT)).toEqual(['README.md'])
  })

  it('offers nothing for letters that are not there in order', () => {
    expect(rankFiles(FILES, 'zzz', LIMIT)).toEqual([])
  })

  it('offers the shortest paths for an empty query', () => {
    expect(rankFiles(FILES, '', 2)).toEqual(['README.md', 'docs/ui.md'])
  })

  // The same query must answer in the same order, or the list shuffles under
  // the caret while somebody is reading it.
  it('breaks ties by length and then by name', () => {
    expect(rankFiles(['b/x.ts', 'a/x.ts', 'long/dir/x.ts'], 'x.ts', LIMIT)).toEqual([
      'a/x.ts',
      'b/x.ts',
      'long/dir/x.ts'
    ])
  })

  it('stops at the limit', () => {
    const many = Array.from({ length: 30 }, (_unused, index) => `file-${String(index)}.ts`)

    expect(rankFiles(many, 'file', 3)).toHaveLength(3)
  })
})
