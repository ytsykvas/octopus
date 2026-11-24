import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import {
  bold,
  bulletList,
  code,
  codeBlock,
  heading,
  italic,
  link,
  orderedList,
  quote,
  strike,
  taskList
} from './markdownCommands.js'

/** `«` and `»` mark the selection, `|` a caret; the answer is written the same way. */
function apply(command: StateCommand, marked: string): string {
  const caret = marked.indexOf('|')
  const anchor = caret === -1 ? marked.indexOf('«') : caret
  const plain = marked.replace(/[|«»]/g, '')
  const head = caret === -1 ? marked.indexOf('»') - 1 : caret
  let state = EditorState.create({
    doc: plain,
    selection: EditorSelection.single(anchor, head)
  })
  const handled = command({
    state,
    dispatch: (transaction) => {
      state = transaction.state
    }
  })
  expect(handled).toBe(true)
  const { from, to } = state.selection.main
  const text = state.doc.toString()
  return from === to
    ? `${text.slice(0, from)}|${text.slice(from)}`
    : `${text.slice(0, from)}«${text.slice(from, to)}»${text.slice(to)}`
}

describe('markdownCommands', () => {
  it.each([
    [bold, 'a «b» c', 'a **«b»** c'],
    [bold, 'a **«b»** c', 'a «b» c'],
    [bold, 'a |', 'a **|**'],
    [bold, '**«b» c', '****«b»** c'],
    [bold, 'a «b»**', 'a **«b»****'],
    [bold, '«b»', '**«b»**'],
    [italic, '«b»', '_«b»_'],
    [strike, '«b»', '~~«b»~~'],
    [code, '«b»', '`«b»`'],
    [code, '`«b»`', '«b»']
  ])('wraps and unwraps', (command, before, after) => {
    expect(apply(command, before)).toBe(after)
  })

  it.each([
    [heading, 'Pl|an', '### Pl|an'],
    [heading, '### Pl|an', 'Pl|an'],
    [quote, '«a\nb»', '> «a\n> b»'],
    [quote, '> «a\n> b»', '«a\nb»'],
    [bulletList, '«a\n\nb»', '- «a\n\n- b»'],
    [bulletList, '|', '- |'],
    [bulletList, '- «a\n- b»', '«a\nb»'],
    [bulletList, '«- a\nb»', '- «- a\n- b»'],
    [taskList, '«a\nb»', '- [ ] «a\n- [ ] b»'],
    [taskList, '- [x] |a', '|a'],
    [orderedList, '«a\nb\nc»', '1. «a\n2. b\n3. c»'],
    [orderedList, '1. «a\n12. b»', '«a\nb»']
  ])('prefixes and unprefixes lines', (command, before, after) => {
    expect(apply(command, before)).toBe(after)
  })

  it.each([
    ['see «docs» now', 'see [docs](|) now'],
    ['see |', 'see [|]()']
  ])('makes a link of %j', (before, after) => {
    expect(apply(link, before)).toBe(after)
  })

  it.each([
    ['a\nb«c\nd»e\nf', 'a\n```\n«bc\nde»\n```\nf'],
    ['|', '```\n|\n```']
  ])('fences %j', (before, after) => {
    expect(apply(codeBlock, before)).toBe(after)
  })
})
