import { describe, expect, it } from 'vitest'

import { toSlug } from './git.js'
import { NAME_POOL_SIZE, nextWorkspaceName, type Random, WORKSPACE_NAMES } from './names.js'

/** A `Random` that walks the given values, so a test can name the pick it wants. */
function sequence(...values: readonly number[]): Random {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)]!
}

/** Always picks the first free candidate — the deterministic case. */
const first: Random = () => 0

/** Asks for `count` names in a row, as a project filling up would. */
function drainPool(count: number, random: Random = first): string[] {
  const taken: string[] = []
  while (taken.length < count) {
    taken.push(nextWorkspaceName(taken, random))
  }
  return taken
}

describe('nextWorkspaceName', () => {
  it('returns a name from the pool', () => {
    expect(WORKSPACE_NAMES).toContain(nextWorkspaceName([]))
  })

  // Randomness only chooses where to start reading; a taken name there does
  // not end the search, it moves it along.
  it('walks on from the starting point when the name there is taken', () => {
    const [firstName, secondName] = WORKSPACE_NAMES
    expect(nextWorkspaceName([firstName!], () => 0)).toBe(secondName)
  })

  it('wraps round the end of the pool rather than giving up', () => {
    const taken = WORKSPACE_NAMES.slice(-1)

    // Starts at the last name, which is taken, so the only way to a free one
    // is back round to the beginning.
    expect(nextWorkspaceName(taken, () => 1)).toBe(WORKSPACE_NAMES[0])
  })

  it('skips names already in use', () => {
    const taken = WORKSPACE_NAMES.slice(0, 3)
    expect(taken).not.toContain(nextWorkspaceName(taken, first))
  })

  it('never returns a name that is taken', () => {
    const taken: string[] = []
    while (taken.length < NAME_POOL_SIZE + 5) {
      const name = nextWorkspaceName(taken, sequence(0.1, 0.9, 0.5, 0.3))
      expect(taken).not.toContain(name)
      taken.push(name)
    }
  })

  // The pool is large, so drawing the same name twice in a row is possible but
  // rare; over many draws an order-based generator would be obvious.
  it('does not hand out names in pool order', () => {
    const drawn = Array.from({ length: 12 }, () => nextWorkspaceName([]))
    expect(new Set(drawn).size).toBeGreaterThan(1)
  })

  it('falls back to a suffix once the pool is exhausted', () => {
    const taken = drainPool(NAME_POOL_SIZE)
    expect(nextWorkspaceName(taken, first)).toBe(`${WORKSPACE_NAMES[0]!}-2`)
  })

  it('keeps counting when the suffixed round is exhausted too', () => {
    const taken = drainPool(NAME_POOL_SIZE * 2)
    expect(nextWorkspaceName(taken, first)).toBe(`${WORKSPACE_NAMES[0]!}-3`)
  })

  it('suffixed names are picked at random too', () => {
    const taken = drainPool(NAME_POOL_SIZE)
    expect(nextWorkspaceName(taken, () => 0.5)).toMatch(/-2$/)
    expect(nextWorkspaceName(taken, () => 0.5)).not.toBe(`${WORKSPACE_NAMES[0]!}-2`)
  })

  // A `Random` is just a function returning a number; one that returns 1 would
  // index past the end and hand back `undefined` as a workspace name.
  it('survives a random source that returns its upper bound', () => {
    expect(WORKSPACE_NAMES).toContain(nextWorkspaceName([], () => 1))
  })

  it('survives a random source that returns a negative number', () => {
    expect(WORKSPACE_NAMES).toContain(nextWorkspaceName([], () => -1))
  })
})

describe('name pool', () => {
  // Names end up in a git ref and a directory path, so anything toSlug would
  // rewrite is a name that reads one way in the UI and another on disk.
  it('every name survives toSlug untouched', () => {
    for (const name of WORKSPACE_NAMES) {
      expect(toSlug(name)).toBe(name)
    }
  })

  it('suffixed names are also slug-safe', () => {
    expect(toSlug(`${WORKSPACE_NAMES[0]!}-2`)).toBe(`${WORKSPACE_NAMES[0]!}-2`)
  })

  it('holds no duplicates, which would waste draws and confuse the eye', () => {
    expect(new Set(WORKSPACE_NAMES).size).toBe(NAME_POOL_SIZE)
  })

  // With random picking, a small pool repeats itself quickly.
  it('is large enough that repeats stay rare', () => {
    expect(NAME_POOL_SIZE).toBeGreaterThanOrEqual(200)
  })
})
