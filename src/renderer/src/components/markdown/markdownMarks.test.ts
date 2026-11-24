import { describe, expect, it } from 'vitest'

import { markdownMarks } from './markdownMarks.js'

const AWAY = '\n\nelsewhere'

function read(text: string, from = text.length, to = from): string[] {
  return markdownMarks(text, { from, to }).map((mark) => {
    switch (mark.kind) {
      case 'line':
        return `line ${mark.style} @${String(mark.at)}`
      case 'text':
        return `${mark.style} ${text.slice(mark.from, mark.to)}`
      case 'syntax':
        return `${mark.hidden ? 'hide' : 'dim'} ${text.slice(mark.from, mark.to)}`
      case 'bullet':
        return `bullet ${text.slice(mark.from, mark.to)}`
      case 'task':
        return `${mark.checked ? 'done' : 'open'} ${text.slice(mark.from, mark.to)}`
    }
  })
}

describe('markdownMarks', () => {
  it.each([
    ['## Plan', ['line h2 @0', 'hide ## ']],
    ['# A #', ['line h1 @0', 'hide # ', 'hide #']],
    ['### C', ['line h3 @0', 'hide ### ']],
    ['#### D', ['line h3 @0', 'hide #### ']],
    ['##### E', ['line h3 @0', 'hide ##### ']],
    ['###### F', ['line h3 @0', 'hide ###### ']],
    [
      '**b** _i_ ~~s~~ `c`',
      [
        'strong **b**',
        'hide **',
        'hide **',
        'em _i_',
        'hide _',
        'hide _',
        'strike ~~s~~',
        'hide ~~',
        'hide ~~',
        'code `c`',
        'hide `',
        'hide `'
      ]
    ],
    [
      '```ts\nx\n```',
      ['line code @0', 'line code @6', 'line code @8', 'dim ```', 'dim ts', 'dim ```']
    ],
    ['    x', ['line code @0']],
    ['> q\n> r', ['line quote @0', 'line quote @4', 'hide > ', 'hide > ']],
    ['- > q', ['bullet -', 'line quote @0', 'hide > ']],
    ['- ## H', ['bullet -', 'line h2 @0', 'hide ## ']],
    ['[t](http://u "ti")', ['link t', 'hide [', 'hide ](http://u "ti")']],
    ['[t][r]', ['link t', 'hide [', 'hide ][r]']],
    ['[](u)', ['hide [', 'hide ](u)']],
    ['- a', ['bullet -']],
    ['1. o', []],
    ['- [ ] t\n- [X] d', ['hide - ', 'open [ ]', 'hide - ', 'done [X]']],
    ['a\n\n---', ['dim ---']],
    ['| a | b |\n| - | - |\n| 1 | 2 |', ['line table @0', 'line table @10', 'line table @20']],
    ['![i](u) <http://a.b> www.x.com', []]
  ])('draws %j away from the caret', (text, expected) => {
    expect(read(text + AWAY)).toEqual(expected)
  })

  it.each([
    ['## Plan', 3, ['line h2 @0', 'dim ## ']],
    ['**b** _i_', 0, ['strong **b**', 'dim **', 'dim **', 'em _i_', 'dim _', 'dim _']],
    ['[t](u)', 1, ['link t', 'dim [', 'dim ](u)']],
    ['- a', 1, ['dim -']],
    ['- [ ] t', 0, ['dim - ', 'dim [ ]']],
    ['```\nx\n```', 5, ['line code @0', 'line code @4', 'line code @6', 'dim ```', 'dim ```']]
  ])('keeps the syntax of %j on the caret line, dimmed', (text, at, expected) => {
    expect(read(text + AWAY, at)).toEqual(expected)
  })

  it('keeps every line the selection touches', () => {
    expect(read('**a**\n**b**\n**c**', 0, 7)).toEqual([
      'strong **a**',
      'dim **',
      'dim **',
      'strong **b**',
      'dim **',
      'dim **',
      'strong **c**',
      'hide **',
      'hide **'
    ])
  })
})
