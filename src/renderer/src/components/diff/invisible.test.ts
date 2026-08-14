import { describe, expect, it } from 'vitest'

import { fileDiff, hunk } from '../../test/diff.js'
import { fileHasInvisible, hasInvisible, splitInvisible } from './invisible.js'

/*
 * Written with escapes rather than the characters themselves.
 *
 * A test file holding a real U+202E is a test file that reads differently from
 * how it runs — which is the whole point of the thing being tested, and would
 * make every later reader of this file wonder what the line actually says.
 */
const RLO = '\u202E'
const PDF = '\u202C'
const ZWSP = '\u200B'
const BOM = '\uFEFF'
const ZWJ = '\u200D'

describe('hasInvisible', () => {
  it('finds a right-to-left override, which reorders what is drawn', () => {
    expect(hasInvisible(`const isAdmin = ${RLO}false`)).toBe(true)
  })

  it('finds a zero-width space, which draws as nothing at all', () => {
    expect(hasInvisible(`user${ZWSP}Name`)).toBe(true)
  })

  it('finds a byte order mark left in the middle of a line', () => {
    expect(hasInvisible(`a${BOM}b`)).toBe(true)
  })

  it('leaves ordinary code alone', () => {
    expect(hasInvisible('const isAdmin = false')).toBe(false)
  })

  it('leaves text in another alphabet alone', () => {
    expect(hasInvisible('const назва = "Привіт"')).toBe(false)
  })

  it('says nothing about a zero-width joiner, which ordinary text is full of', () => {
    // Persian and Indic scripts need it, and every emoji built from several
    // code points carries one. A warning that fires here fires everywhere.
    expect(hasInvisible(`👩${ZWJ}💻`)).toBe(false)
  })

  it('answers the same way twice for the same line', () => {
    // A `g` regexp keeps its own position between calls, and the second answer
    // would be wrong if that position were not reset.
    const line = `x${RLO}y`
    expect(hasInvisible(line)).toBe(true)
    expect(hasInvisible(line)).toBe(true)
  })
})

describe('splitInvisible', () => {
  it('leaves a line with nothing to show as one piece', () => {
    expect(splitInvisible('plain')).toEqual([{ text: 'plain' }])
  })

  it('names the character by its code point', () => {
    expect(splitInvisible(`a${RLO}b`)).toEqual([{ text: 'a' }, { code: 'U+202E' }, { text: 'b' }])
  })

  it('keeps the text on both sides of several of them', () => {
    expect(splitInvisible(`${RLO}a${PDF}`)).toEqual([
      { code: 'U+202E' },
      { text: 'a' },
      { code: 'U+202C' }
    ])
  })

  it('pads a short code point to four digits, as the standard writes it', () => {
    expect(splitInvisible(`x\u061C`)).toEqual([{ text: 'x' }, { code: 'U+061C' }])
  })

  it('handles a line that is nothing but the character', () => {
    expect(splitInvisible(RLO)).toEqual([{ code: 'U+202E' }])
  })
})

describe('fileHasInvisible', () => {
  it('finds one anywhere in the file', () => {
    const file = fileDiff('src/auth.ts', {
      hunks: [
        hunk({
          lines: [
            { kind: 'context', text: 'kept', oldNumber: 1, newNumber: 1, noNewline: false },
            {
              kind: 'added',
              text: `if (user.isAdmin) { ${RLO}`,
              oldNumber: null,
              newNumber: 2,
              noNewline: false
            }
          ]
        })
      ]
    })

    expect(fileHasInvisible(file)).toBe(true)
  })

  it('says no for a file whose lines are all ordinary', () => {
    expect(fileHasInvisible(fileDiff('src/auth.ts'))).toBe(false)
  })

  it('says no for a file with no lines to look at', () => {
    expect(fileHasInvisible(fileDiff('big.min.js', { omitted: 'tooLarge', hunks: [] }))).toBe(false)
  })

  it('finds one in the name, which is drawn from the same bytes as the lines', () => {
    expect(fileHasInvisible(fileDiff(`src/report${RLO}gnp.js`, { hunks: [] }))).toBe(true)
  })
})
