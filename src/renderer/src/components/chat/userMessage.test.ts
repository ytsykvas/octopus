import { describe, expect, it } from 'vitest'

import { mergeNotes, withNotes } from './attachments.js'
import { inlineParts, messageBlocks } from './userMessage.js'

const INTROS = {
  diff: 'Review notes on the changes:',
  pullRequest: 'From the review:',
  oldSide: '(as it was)',
  files: 'Files:'
}

describe('messageBlocks', () => {
  it('leaves a plain message as one block of text, its blank lines kept', () => {
    expect(messageBlocks('fix the login\n\nthanks')).toEqual([
      { kind: 'text', parts: ['fix the login\n\nthanks'] }
    ])
    expect(messageBlocks('')).toEqual([])
  })

  // What `withNotes` writes is what this has to read back, so the two are
  // tested together rather than against a hand-written copy of the format.
  it('reads back the notes the composer wrote, each kind, in order', () => {
    const message = withNotes(
      'Look at both.',
      mergeNotes(
        [
          {
            path: 'src/a.ts',
            side: 'old',
            line: 3,
            endLine: 4,
            code: 'one\n\ntwo > three',
            text: 'Why was this dropped?'
          }
        ],
        [],
        [{ path: 'src/b.ts', line: 9, endLine: 9, code: 'const b = 2', text: '' }]
      ),
      INTROS
    )

    expect(messageBlocks(message)).toEqual([
      { kind: 'text', parts: ['Review notes on the changes:'] },
      {
        kind: 'note',
        path: 'src/a.ts',
        range: '3-4',
        suffix: '(as it was)',
        quote: 'one\n\ntwo > three',
        text: 'Why was this dropped?'
      },
      {
        kind: 'note',
        path: 'src/b.ts',
        range: '9',
        suffix: null,
        quote: 'const b = 2',
        text: ''
      },
      { kind: 'text', parts: ['Look at both.'] }
    ])
  })

  it('takes a heading without a quote under it for a sentence', () => {
    expect(messageBlocks('src/a.ts:12\nis where it breaks')).toEqual([
      {
        kind: 'text',
        parts: [{ path: 'src/a.ts', range: '12' }, '\nis where it breaks']
      }
    ])
  })

  it('keeps a remark of several lines, up to the blank line', () => {
    expect(messageBlocks('a.ts:1\n> x\nfirst\nsecond\n\nafter')).toEqual([
      { kind: 'note', path: 'a.ts', range: '1', suffix: null, quote: 'x', text: 'first\nsecond' },
      { kind: 'text', parts: ['after'] }
    ])
  })
})

describe('inlineParts', () => {
  it('picks out references to lines of a file', () => {
    expect(inlineParts('see src/core/a.ts:12-18 and Makefile/x:3, then README.md:4.')).toEqual([
      'see ',
      { path: 'src/core/a.ts', range: '12-18' },
      ' and ',
      { path: 'Makefile/x', range: '3' },
      ', then ',
      { path: 'README.md', range: '4' },
      '.'
    ])
  })

  it('leaves times, ports in URLs and bare numbers alone', () => {
    for (const text of [
      'at 10:30 tomorrow',
      'open http://localhost.dev:3000/x',
      'ratio 3:4',
      'a.ts:12abc'
    ]) {
      expect(inlineParts(text)).toEqual([text])
    }
  })

  it('answers nothing for nothing', () => {
    expect(inlineParts('')).toEqual([])
  })
})
