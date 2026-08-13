import { describe, expect, it } from 'vitest'

import { type ChangeLine, lineDiff, readChange } from './changeSummary.js'

/** The diff as a diff reads: `- gone`, `+ new`, a space for what stayed. */
const shown = (lines: readonly ChangeLine[]): string[] =>
  lines.map((line) => `${line.sign}${line.text}`)

describe('a line diff', () => {
  it('says nothing changed when nothing did', () => {
    expect(shown(lineDiff('a\nb', 'a\nb'))).toEqual([' a', ' b'])
  })

  it('reports an insertion as an insertion', () => {
    expect(shown(lineDiff('a\nc', 'a\nb\nc'))).toEqual([' a', '+b', ' c'])
  })

  it('reports a deletion as a deletion', () => {
    expect(shown(lineDiff('a\nb\nc', 'a\nc'))).toEqual([' a', '-b', ' c'])
  })

  /*
   * The reason this is a diff at all rather than "everything out, everything
   * in". A one-line change inside ten lines of context is true of the fragment
   * either way and useless about the change, and the counts drawn beside it
   * would be ten and ten.
   */
  it('keeps the lines that stayed, around the one that did not', () => {
    const lines = lineDiff('one\ntwo\nthree\nfour', 'one\nTWO\nthree\nfour')

    expect(shown(lines)).toEqual([' one', '-two', '+TWO', ' three', ' four'])
  })

  /*
   * The classic trap for a longest-common-subsequence walk.
   *
   * A line that appears more than once has more than one honest answer — which
   * copy was dropped is a tie the walk may break either way, and asserting one
   * of them would be testing the tie-break rather than the diff. What must hold
   * is that only one line moved: a walk that picks badly reports lines as
   * removed and added that never went anywhere, which is how a one-line change
   * comes out as `+4 −4`.
   */
  it('keeps the repeated lines that stayed, rather than churning them', () => {
    const lines = lineDiff('a\na\nb\na', 'a\nb\na')

    expect(lines.filter((line) => line.sign === '-')).toHaveLength(1)
    expect(lines.filter((line) => line.sign === '+')).toHaveLength(0)
  })

  /*
   * What makes a diff a diff, asserted rather than assumed.
   *
   * Read the lines it kept and the ones it removed and you must have the text
   * before; read the kept and the added and you must have the text after. A
   * walk that drops or invents a line satisfies neither, and no amount of
   * looking at a rendered diff would reliably show it.
   */
  it.each([
    ['a\nb\nc', 'a\nB\nc'],
    ['a\na\nb\na', 'a\nb\na'],
    ['one\ntwo', 'three\nfour'],
    ['', 'a\nb'],
    ['a\nb', ''],
    ['same', 'same'],
    ['x', 'x\ny\nz']
  ])('reconstructs both sides exactly (%j → %j)', (before, after) => {
    const lines = lineDiff(before, after)
    const join = (signs: string[]): string =>
      lines
        .filter((line) => signs.includes(line.sign))
        .map((line) => line.text)
        .join('\n')

    expect(join([' ', '-'])).toBe(before)
    expect(join([' ', '+'])).toBe(after)
  })

  // Nothing in common at all: everything out, then everything in, and no
  // pretence that a line survived.
  it('reports a wholesale replacement as one', () => {
    expect(shown(lineDiff('one\ntwo', 'three\nfour'))).toEqual(['-one', '-two', '+three', '+four'])
  })

  it('handles a line growing into several', () => {
    expect(shown(lineDiff('a', 'a\nb\nc'))).toEqual([' a', '+b', '+c'])
  })

  it('handles either side being empty', () => {
    expect(shown(lineDiff('', 'a\nb'))).toEqual(['+a', '+b'])
    expect(shown(lineDiff('a\nb', ''))).toEqual(['-a', '-b'])
  })

  // Files end with a newline, so nearly every fragment does. Counted as a line
  // of its own it would put a phantom mark on almost every change there is.
  it('does not invent a line from the newline that ends a fragment', () => {
    expect(shown(lineDiff('a\n', 'a\nb\n'))).toEqual([' a', '+b'])
  })
})

describe('what a tool call changed', () => {
  it('reads an edit as the lines it replaced and the lines it wrote', () => {
    const change = readChange('Edit', {
      file_path: '/src/core/service.ts',
      old_string: 'const session = get(id)',
      new_string: 'const running = get(id)\nawait running.setMode(mode)'
    })

    expect(change?.path).toBe('/src/core/service.ts')
    expect(change?.removed).toBe(1)
    expect(change?.added).toBe(2)
  })

  /*
   * What stood there before is not in the call. A "before" invented for the
   * sake of a tidier diff would be the one part of this the reader could not
   * check against anything.
   */
  it('reads a write as all additions, because that is all it knows', () => {
    const change = readChange('Write', { file_path: '/a.ts', content: 'one\ntwo\nthree\n' })

    expect(change?.added).toBe(3)
    expect(change?.removed).toBe(0)
    expect(shown(change?.lines ?? [])).toEqual(['+one', '+two', '+three'])
  })

  it('counts only the lines that moved, not the ones that stayed', () => {
    const change = readChange('Edit', {
      file_path: '/a.ts',
      old_string: 'one\ntwo\nthree',
      new_string: 'one\nTWO\nthree'
    })

    expect(change?.added).toBe(1)
    expect(change?.removed).toBe(1)
    expect(change?.lines).toHaveLength(4)
  })

  it('answers nothing for a tool that changes no file', () => {
    expect(readChange('Grep', { pattern: 'octopus' })).toBeNull()
    expect(readChange('Bash', { command: 'ls' })).toBeNull()
  })

  // The arguments belong to whichever tool the model picked, and the event
  // schema passes them through unread. A call that does not carry what its name
  // promises is drawn as an ordinary row rather than crashing the log.
  it('answers nothing when the arguments are not what the name promises', () => {
    expect(readChange('Edit', { file_path: '/a.ts' })).toBeNull()
    expect(readChange('Edit', { old_string: 'a', new_string: 'b' })).toBeNull()
    expect(readChange('Write', { file_path: '', content: 'x' })).toBeNull()
    expect(readChange('Edit', 'not an object at all')).toBeNull()
  })
})
