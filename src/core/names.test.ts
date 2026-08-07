import { describe, expect, it } from 'vitest'

import { toSlug } from './git.js'
import { NAME_POOL_SIZE, nextWorkspaceName } from './names.js'

/** Asks for `count` names in a row, as a project filling up would. */
function drainPool(count: number): string[] {
  const taken: string[] = []
  while (taken.length < count) {
    taken.push(nextWorkspaceName(taken))
  }
  return taken
}

describe('nextWorkspaceName', () => {
  it('starts from the first name when nothing is taken', () => {
    expect(nextWorkspaceName([])).toBe('anna')
  })

  it('skips names already in use', () => {
    expect(nextWorkspaceName(['anna'])).toBe('maria')
    expect(nextWorkspaceName(['anna', 'maria'])).toBe('sofia')
  })

  it('ignores gaps — it takes the first free name, not the next one along', () => {
    expect(nextWorkspaceName(['maria', 'sofia'])).toBe('anna')
  })

  it('never returns a name that is taken', () => {
    const taken: string[] = []
    while (taken.length < NAME_POOL_SIZE + 5) {
      const name = nextWorkspaceName(taken)
      expect(taken).not.toContain(name)
      taken.push(name)
    }
  })

  it('falls back to a suffix once the pool is exhausted', () => {
    const taken = drainPool(NAME_POOL_SIZE)
    expect(nextWorkspaceName(taken)).toBe('anna-2')
  })

  it('keeps counting when the suffixed round is exhausted too', () => {
    const taken = drainPool(NAME_POOL_SIZE * 2)
    expect(nextWorkspaceName(taken)).toBe('anna-3')
  })
})

describe('name pool', () => {
  // Names end up in a git ref and a directory path, so anything toSlug would
  // rewrite is a name that reads one way in the UI and another on disk.
  it('every generated name survives toSlug untouched', () => {
    for (const name of drainPool(NAME_POOL_SIZE)) {
      expect(toSlug(name)).toBe(name)
    }
  })

  it('suffixed names are also slug-safe', () => {
    expect(toSlug('anna-2')).toBe('anna-2')
  })

  it('offers enough names to be useful before suffixing', () => {
    expect(NAME_POOL_SIZE).toBeGreaterThanOrEqual(20)
  })
})
