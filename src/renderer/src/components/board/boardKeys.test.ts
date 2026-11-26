import { describe, expect, it } from 'vitest'

import type { BoardCard } from '@core/boardSchema.js'

import { boardCard } from '../../test/board.js'
import type { BoardColumns } from './boardDrop.js'
import {
  type BoardKey,
  type BoardKeyAction,
  type BoardKeyContext,
  boardKeyAction,
  cardRefs,
  focusedCard,
  nextFocus,
  stepIndex
} from './boardKeys.js'

function key(k: string, mods: Partial<Omit<BoardKey, 'key'>> = {}): BoardKey {
  return {
    key: k,
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods
  }
}

const CONTEXT: BoardKeyContext = { focused: 'a', open: null, reorderable: true }

describe('boardKeyAction', () => {
  it.each<[BoardKey, Partial<BoardKeyContext>, BoardKeyAction | null]>([
    [key('c'), {}, { kind: 'create', from: 'a' }],
    [key('c'), { focused: null }, { kind: 'create', from: null }],
    [key('C'), {}, { kind: 'create', from: 'a' }],
    [key('C', { shiftKey: true }), {}, { kind: 'brainstorm', from: 'a' }],
    [
      key('С', { code: 'KeyC', shiftKey: true }),
      { focused: null },
      { kind: 'brainstorm', from: null }
    ],
    [key('J', { shiftKey: true }), {}, null],
    [key('c', { ctrlKey: true }), {}, null],
    [key('Enter'), {}, null],
    [key('Escape'), { open: 'b' }, { kind: 'close', ref: 'b' }],
    [key('Escape'), {}, { kind: 'blur', ref: 'a' }],
    [key('Escape'), { focused: null }, null],
    [key('j'), {}, { kind: 'focus', from: 'a', direction: 'down' }],
    [
      key('ArrowDown'),
      { focused: null, open: 'b' },
      { kind: 'focus', from: 'b', direction: 'down' }
    ],
    [key('ArrowDown'), { focused: null }, { kind: 'focus', from: null, direction: 'down' }],
    [key('k'), {}, { kind: 'focus', from: 'a', direction: 'up' }],
    [key('ArrowUp'), {}, { kind: 'focus', from: 'a', direction: 'up' }],
    [key('ArrowRight'), {}, { kind: 'focus', from: 'a', direction: 'right' }],
    [key('ArrowLeft'), {}, { kind: 'focus', from: 'a', direction: 'left' }],
    [key('ArrowUp', { altKey: true }), {}, { kind: 'step', ref: 'a', step: -1 }],
    [
      key('ArrowDown', { altKey: true }),
      { focused: null, open: 'b' },
      { kind: 'step', ref: 'b', step: 1 }
    ],
    [key('ArrowDown', { altKey: true }), { reorderable: false }, null],
    [key('ArrowDown', { altKey: true }), { focused: null }, null],
    [key('ArrowDown', { altKey: true, metaKey: true }), {}, null],
    [key('x', { altKey: true }), {}, null],
    [key('Backspace', { metaKey: true }), {}, { kind: 'remove', ref: 'a' }],
    [
      key('Backspace', { metaKey: true }),
      { focused: null, open: 'b' },
      { kind: 'remove', ref: 'b' }
    ],
    [key('Backspace', { metaKey: true }), { focused: null }, null],
    [key('Backspace', { metaKey: true, shiftKey: true }), {}, null],
    [key('Backspace'), {}, null],
    [key('с', { code: 'KeyC' }), {}, { kind: 'create', from: 'a' }],
    [key('о', { code: 'KeyJ' }), {}, { kind: 'focus', from: 'a', direction: 'down' }],
    [key('л', { code: 'KeyK' }), {}, { kind: 'focus', from: 'a', direction: 'up' }],
    [key('j', { code: 'KeyC' }), {}, { kind: 'focus', from: 'a', direction: 'down' }],
    [key('ы', { code: 'KeyS' }), {}, null],
    [key('s'), {}, null],
    [key('x'), {}, null]
  ])('%o with %o gives %o', (event, context, expected) => {
    expect(boardKeyAction(event, { ...CONTEXT, ...context })).toEqual(expected)
  })
})

describe('nextFocus', () => {
  const COLUMNS = [['a', 'b', 'c'], [], ['p'], ['q', 'r']]

  it.each<[string | null, 'up' | 'down' | 'left' | 'right', string]>([
    [null, 'down', 'a'],
    ['gone', 'up', 'a'],
    ['a', 'down', 'b'],
    ['c', 'down', 'c'],
    ['b', 'up', 'a'],
    ['a', 'up', 'a'],
    ['c', 'right', 'p'],
    ['p', 'right', 'q'],
    ['r', 'right', 'r'],
    ['r', 'left', 'p'],
    ['p', 'left', 'a'],
    ['a', 'left', 'a']
  ])('from %s going %s lands on %s', (ref, direction, expected) => {
    expect(nextFocus(COLUMNS, ref, direction)).toBe(expected)
  })

  it('lands nowhere on an empty board', () => {
    expect(nextFocus([[], []], null, 'down')).toBeNull()
  })
})

describe('stepIndex', () => {
  const card = (ref: string, order?: number): BoardCard =>
    boardCard({ ref, meta: { links: [], runs: [], ...(order === undefined ? {} : { order }) } })
  const COLUMN = [card('a', 1), card('b', 2), card('u'), card('v')]

  it.each<[string, -1 | 1, number | null]>([
    ['a', -1, null],
    ['b', -1, 0],
    ['a', 1, 1],
    ['b', 1, null],
    ['u', -1, 1],
    ['u', 1, null],
    ['v', -1, 2],
    ['gone', 1, null]
  ])('steps %s by %i to %s', (ref, step, expected) => {
    expect(stepIndex(COLUMN, ref, step)).toBe(expected)
  })

  it('does not step the only card down', () => {
    expect(stepIndex([card('a', 1)], 'a', 1)).toBeNull()
  })
})

describe('cardRefs', () => {
  it('lists the refs column by column', () => {
    const columns: BoardColumns = new Map([
      ['backlog', [boardCard({ ref: 'a' }), boardCard({ ref: 'b' })]],
      ['in progress', [boardCard({ ref: 'p', status: 'in progress' })]],
      ['Ideas', []]
    ])

    expect(cardRefs(columns)).toEqual([['a', 'b'], ['p'], []])
  })
})

describe('focusedCard', () => {
  function cardButton(ref: string): HTMLButtonElement {
    const button = document.createElement('button')
    button.dataset.cardRef = ref
    return button
  }

  it.each<[string, () => EventTarget | null, string | null | undefined]>([
    ['the body', () => document.body, null],
    ['a card button', () => cardButton('backlog/a.md'), 'backlog/a.md'],
    ['another button', () => document.createElement('button'), undefined],
    ['a field', () => document.createElement('input'), undefined],
    ['the document', () => document, undefined],
    ['nothing', () => null, undefined]
  ])('on %s gives %s', (_name, target, expected) => {
    expect(focusedCard(target())).toBe(expected)
  })
})
