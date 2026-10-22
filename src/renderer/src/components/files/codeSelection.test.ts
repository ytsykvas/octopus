import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { codeReference, lineRange } from '../codeReference.js'
import { codeSelection, type LineGeometry } from './codeSelection.js'

/** The viewer's own: 18px lines under 12px of padding. */
const GEOMETRY: LineGeometry = { height: 18, padding: 12 }

const read = (code: HTMLElement, selection: Selection | null): ReturnType<typeof codeSelection> =>
  codeSelection(code, selection, GEOMETRY)

/** The viewer's two shapes of the same three lines. */
function plain(): HTMLElement {
  const code = document.createElement('pre')
  code.textContent = 'one\ntwo\nthree'
  document.body.append(code)
  return code
}

function highlighted(): HTMLElement {
  const code = document.createElement('pre')
  code.innerHTML =
    '<span>on</span><span>e</span>\n<span>two</span>\n<span>th</span><span>ree</span>'
  document.body.append(code)
  return code
}

function select(start: Node, startOffset: number, end: Node, endOffset: number): Selection {
  const range = document.createRange()
  range.setStart(start, startOffset)
  range.setEnd(end, endOffset)
  const selection = window.getSelection()
  if (selection === null) throw new Error('jsdom has no selection')
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

const text = (node: Node | null | undefined): Node => {
  if (!node) throw new Error('no such node')
  return node
}

// jsdom lays nothing out, so a range has no box to answer with.
beforeEach(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect(20, 100, 80, 16)
})

afterEach(() => {
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
})

describe('codeSelection', () => {
  it('numbers the lines of a plain file from the text', () => {
    const code = plain()
    const node = text(code.firstChild)

    // "wo\nth" — from inside line two to inside line three.
    expect(read(code, select(node, 5, node, 10))).toMatchObject({ line: 2, endLine: 3 })
    expect(read(code, select(node, 0, node, 2))).toMatchObject({ line: 1, endLine: 1 })
  })

  it('numbers them the same across the spans of a highlighted file', () => {
    const code = highlighted()
    const spans = code.querySelectorAll('span')

    expect(
      read(code, select(text(spans[1]?.firstChild), 0, text(spans[3]?.firstChild), 1))
    ).toMatchObject({ line: 1, endLine: 3 })
  })

  // A triple-click on line two selects up to the start of line three.
  it('does not take a line the selection only reaches the start of', () => {
    const code = plain()
    const node = text(code.firstChild)

    expect(read(code, select(node, 4, node, 8))).toMatchObject({ line: 2, endLine: 2 })
  })

  it('cuts a selection dragged past the code at its edges', () => {
    const before = document.createElement('p')
    before.textContent = 'banner'
    document.body.append(before)
    const code = plain()
    const after = document.createElement('p')
    after.textContent = 'below'
    document.body.append(after)

    expect(read(code, select(text(before.firstChild), 2, text(after.firstChild), 3))).toMatchObject(
      { line: 1, endLine: 3 }
    )
  })

  it('answers nothing for no selection, a click, or text outside the code', () => {
    const code = plain()
    const outside = document.createElement('p')
    outside.textContent = 'elsewhere'
    document.body.append(outside)
    const node = text(code.firstChild)

    expect(read(code, null)).toBeNull()
    expect(read(code, select(node, 2, node, 2))).toBeNull()
    expect(read(code, select(text(outside.firstChild), 0, text(outside.firstChild), 4))).toBeNull()
    window.getSelection()?.removeAllRanges()
    expect(read(code, window.getSelection())).toBeNull()
  })

  /*
   * Placed from the line numbers and the code's own box rather than measured
   * from the range: jsdom's box is all zeros, so the numbers below are the
   * padding and the lines alone. Within one line the toolbar sits at the first
   * selected character, which is the one rect still asked for.
   */
  it('says where the selection is, for the toolbar', () => {
    const code = plain()
    const node = text(code.firstChild)

    expect(read(code, select(node, 1, node, 3))).toEqual({
      line: 1,
      endLine: 1,
      top: 12,
      bottom: 30,
      left: 20
    })
    expect(read(code, select(node, 5, node, 10))).toMatchObject({ top: 30, bottom: 66 })
  })

  // Several lines span the whole column, so the toolbar sits where they begin.
  it('places a selection of several lines at the code’s left edge', () => {
    const code = plain()
    code.getBoundingClientRect = () => new DOMRect(40, 200, 600, 300)
    const node = text(code.firstChild)

    expect(read(code, select(node, 5, node, 10))).toMatchObject({
      top: 230,
      bottom: 266,
      left: 40
    })
  })

  // Begun above the code, there is no first character of its own to sit at.
  it('places a selection begun outside the code at its edge, even within one line', () => {
    const before = document.createElement('p')
    before.textContent = 'banner'
    document.body.append(before)
    const code = plain()
    const node = text(code.firstChild)

    expect(read(code, select(text(before.firstChild), 2, node, 2))).toMatchObject({
      line: 1,
      endLine: 1,
      left: 0
    })
  })
})

describe('codeReference', () => {
  it('names one line, or the range of several', () => {
    expect(codeReference('src/a.ts', 12, 12)).toBe('src/a.ts:12')
    expect(codeReference('src/a.ts', 12, 18)).toBe('src/a.ts:12-18')
    expect(lineRange(4, 4)).toBe('4')
  })
})
