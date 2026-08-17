import { describe, expect, it } from 'vitest'

import { lineAddress, selectionAnchor } from './selectionAnchor.js'

describe('a line address', () => {
  it('says where a line is', () => {
    expect(lineAddress('src/a.ts', 'new', 42)).toBe('src/a.ts:new:42')
  })
})

describe('the note a selection would make', () => {
  it('is nothing when nothing was selected', () => {
    expect(selectionAnchor([])).toBeNull()
  })

  it('covers one line when one was touched', () => {
    expect(selectionAnchor([lineAddress('src/a.ts', 'new', 42)])).toEqual({
      path: 'src/a.ts',
      side: 'new',
      line: 42,
      endLine: 42
    })
  })

  it('runs from the first line touched to the last', () => {
    const addresses = [42, 43, 44].map((line) => lineAddress('src/a.ts', 'new', line))

    expect(selectionAnchor(addresses)).toEqual({
      path: 'src/a.ts',
      side: 'new',
      line: 42,
      endLine: 44
    })
  })

  /*
   * Dragging past the end of a file is how a reader selects the end of a file.
   * A gesture that answers nothing because it went one line too far teaches
   * people to drag carefully rather than to select what they mean.
   */
  it('stops at the end of the file it started in', () => {
    expect(
      selectionAnchor([
        lineAddress('src/a.ts', 'new', 8),
        lineAddress('src/a.ts', 'new', 9),
        lineAddress('src/b.ts', 'new', 1)
      ])
    ).toEqual({ path: 'src/a.ts', side: 'new', line: 8, endLine: 9 })
  })

  // Side by side, the two columns are two files, and a selection dragged across
  // the divider has touched a line number that means something else entirely.
  it('keeps to the side it started on', () => {
    expect(
      selectionAnchor([
        lineAddress('src/a.ts', 'old', 3),
        lineAddress('src/a.ts', 'new', 3),
        lineAddress('src/a.ts', 'old', 4)
      ])
    ).toEqual({ path: 'src/a.ts', side: 'old', line: 3, endLine: 4 })
  })

  // The path is the part that can hold a colon, so the address is read from the
  // right — split from the left, half a filename would end up in the side.
  it('reads a path that has a colon in it', () => {
    expect(selectionAnchor([lineAddress('src/a:b.ts', 'new', 7)])).toEqual({
      path: 'src/a:b.ts',
      side: 'new',
      line: 7,
      endLine: 7
    })
  })

  /*
   * The DOM is the one place these strings can be tampered with, and it is the
   * side of the app that renders agent output. Nothing should be able to write
   * a note against a place that does not exist by putting a word where a line
   * number goes.
   */
  it('ignores anything that is not an address', () => {
    expect(selectionAnchor(['nonsense', 'src/a.ts:sideways:1', 'src/a.ts:new:abc'])).toBeNull()
  })

  it('keeps the addresses it understands from among ones it does not', () => {
    expect(selectionAnchor(['nonsense', lineAddress('src/a.ts', 'new', 5)])).toEqual({
      path: 'src/a.ts',
      side: 'new',
      line: 5,
      endLine: 5
    })
  })
})
