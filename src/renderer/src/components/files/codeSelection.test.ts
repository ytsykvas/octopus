import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { codeReference, lineRange } from '../codeReference.js'
import { codeSelection } from './codeSelection.js'

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
    expect(codeSelection(code, select(node, 5, node, 10))).toMatchObject({ line: 2, endLine: 3 })
    expect(codeSelection(code, select(node, 0, node, 2))).toMatchObject({ line: 1, endLine: 1 })
  })

  it('numbers them the same across the spans of a highlighted file', () => {
    const code = highlighted()
    const spans = code.querySelectorAll('span')

    expect(
      codeSelection(code, select(text(spans[1]?.firstChild), 0, text(spans[3]?.firstChild), 1))
    ).toMatchObject({ line: 1, endLine: 3 })
  })

  // A triple-click on line two selects up to the start of line three.
  it('does not take a line the selection only reaches the start of', () => {
    const code = plain()
    const node = text(code.firstChild)

    expect(codeSelection(code, select(node, 4, node, 8))).toMatchObject({ line: 2, endLine: 2 })
  })

  it('cuts a selection dragged past the code at its edges', () => {
    const before = document.createElement('p')
    before.textContent = 'banner'
    document.body.append(before)
    const code = plain()
    const after = document.createElement('p')
    after.textContent = 'below'
    document.body.append(after)

    expect(
      codeSelection(code, select(text(before.firstChild), 2, text(after.firstChild), 3))
    ).toMatchObject({ line: 1, endLine: 3 })
  })

  it('answers nothing for no selection, a click, or text outside the code', () => {
    const code = plain()
    const outside = document.createElement('p')
    outside.textContent = 'elsewhere'
    document.body.append(outside)
    const node = text(code.firstChild)

    expect(codeSelection(code, null)).toBeNull()
    expect(codeSelection(code, select(node, 2, node, 2))).toBeNull()
    expect(
      codeSelection(code, select(text(outside.firstChild), 0, text(outside.firstChild), 4))
    ).toBeNull()
    window.getSelection()?.removeAllRanges()
    expect(codeSelection(code, window.getSelection())).toBeNull()
  })

  it('says where the selection is, for the toolbar', () => {
    const code = plain()
    const node = text(code.firstChild)

    // Its left edge, where the lines begin, for a toolbar to sit over.
    expect(codeSelection(code, select(node, 0, node, 3))).toEqual({
      line: 1,
      endLine: 1,
      top: 100,
      bottom: 116,
      left: 20
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
