import { describe, expect, it } from 'vitest'

import type { CodeNote } from '../../hooks/useCodeNotes.js'
import type { DiffComment } from '../../hooks/useDiffComments.js'
import type { PullRequestQuote } from '../../hooks/usePullRequestQuotes.js'

import { type ChatNote, insertPaths, mergeNotes, noteKey, withNotes } from './attachments.js'

const INTROS = {
  diff: 'Review notes:',
  pullRequest: 'From the review:',
  oldSide: '(as it was)'
}

const comment = (overrides: Partial<DiffComment> = {}): DiffComment => ({
  path: 'src/core/diff.ts',
  side: 'new',
  line: 42,
  endLine: 42,
  code: 'const b = 2',
  text: 'This should be 3.',
  ...overrides
})

const note = (overrides: Partial<DiffComment> = {}): ChatNote => ({
  kind: 'diff',
  ...comment(overrides)
})

const quote = (overrides: Partial<PullRequestQuote> = {}): PullRequestQuote => ({
  key: 'inline:PRRC_1',
  reference: '#812',
  author: 'olena',
  place: 'src/core/git.ts:42',
  quote: '@@ -1 +1 @@\n-const a = 1',
  body: 'Why the second case?',
  ...overrides
})

const viewed = (overrides: Partial<CodeNote> = {}): CodeNote => ({
  path: 'src/core/git.ts',
  line: 7,
  endLine: 9,
  code: 'a\nb\nc',
  text: 'Why three?',
  ...overrides
})

const remark = (overrides: Partial<PullRequestQuote> = {}): ChatNote => ({
  kind: 'pullRequest',
  ...quote(overrides)
})

describe('what identifies a note', () => {
  /*
   * A diff note is identified by where it is and a review remark by the id
   * GitHub gave it. Nothing promises those two namespaces never collide, and a
   * collision would drop one of the two from the strip with nothing failing.
   */
  it('keeps each kind in a namespace of its own', () => {
    const keys = [
      noteKey(note({ path: '7', line: 0, endLine: 0 })),
      noteKey({ kind: 'code', ...viewed({ path: '7', line: 0, endLine: 0 }) }),
      noteKey(remark({ key: '7' }))
    ]

    expect(new Set(keys).size).toBe(3)
  })
})

describe('the two queues as one list', () => {
  /*
   * A message that answers a reviewer usually ends with the code it is about,
   * so the diff's notes come first and the review follows.
   */
  it('puts the notes on the change before the remarks about it', () => {
    const merged = mergeNotes([comment()], [quote()])

    expect(merged.map((entry) => entry.kind)).toEqual(['diff', 'pullRequest'])
  })

  // Remarks on the code, like the diff's, so they follow them.
  it('puts the viewer’s notes after the diff’s and before the review', () => {
    const merged = mergeNotes([comment()], [quote()], [viewed()])

    expect(merged.map((entry) => entry.kind)).toEqual(['diff', 'code', 'pullRequest'])
  })

  it('answers with nothing when neither queue holds anything', () => {
    expect(mergeNotes([], [])).toEqual([])
  })
})

describe('writing the notes into the message', () => {
  it('writes a note from the viewer after the diff’s, with no heading of its own', () => {
    expect(withNotes('Look.', mergeNotes([comment()], [], [viewed()]), INTROS)).toBe(
      [
        'Review notes:',
        'src/core/diff.ts:42\n> const b = 2\nThis should be 3.',
        'src/core/git.ts:7-9\n> a\n> b\n> c\nWhy three?',
        'Look.'
      ].join('\n\n')
    )
  })

  // The lines and their place are worth sending without a word about them.
  it('sends a note with no words as its reference and lines alone', () => {
    expect(
      withNotes(
        '',
        mergeNotes([], [], [viewed({ line: 7, endLine: 7, code: 'a', text: '' })]),
        INTROS
      )
    ).toBe('src/core/git.ts:7\n> a')
  })

  it('leaves a message with no notes exactly as it was typed', () => {
    expect(withNotes('rerun the tests', [], INTROS)).toBe('rerun the tests')
  })

  // Nothing implicit reaches the agent (§4): what goes out is the message the
  // user can read back in the log.
  it('writes each note into the message, with the line it is about', () => {
    expect(withNotes('fix these', [note()], INTROS)).toBe(
      'Review notes:\n\nsrc/core/diff.ts:42\n> const b = 2\nThis should be 3.\n\nfix these'
    )
  })

  /*
   * The side is the difference between an address and a wrong address. A note
   * on a removed line is numbered in the file **before** the change, and the
   * pane knows that everywhere — `anchorOf` records it, `anchorKey` spells it,
   * the aria-label says it — while this was the one place it reached the agent.
   *
   * The quote saves a distinctive line. For `}` or `return null` the number is
   * the only thing telling two apart, and after a large deletion the two
   * numberings have drifted by everything added above.
   */
  it('says when a note is about the file as it was', () => {
    expect(withNotes('fix these', [note({ side: 'old' })], INTROS)).toBe(
      'Review notes:\n\nsrc/core/diff.ts:42 (as it was)\n> const b = 2\nThis should be 3.\n\nfix these'
    )
  })

  // And says nothing extra about the ordinary case, which is nearly all of
  // them: `SplitRowView` prefers the right-hand line, so an old anchor is rare.
  it('leaves a note about the file as it is unmarked', () => {
    expect(withNotes('fix these', [note({ side: 'new' })], INTROS)).toBe(
      'Review notes:\n\nsrc/core/diff.ts:42\n> const b = 2\nThis should be 3.\n\nfix these'
    )
  })

  // A passage keeps both, so the range and the side are read together.
  it('marks a passage on the old side as well as a single line', () => {
    expect(withNotes('', [note({ side: 'old', line: 8, endLine: 11 })], INTROS)).toContain(
      'src/core/diff.ts:8-11 (as it was)'
    )
  })

  /*
   * A passage names both ends and quotes every line of itself. One `>` and then
   * bare lines would read as a quote that ended and a message that began, which
   * is the confusion the marker exists to prevent.
   */
  it('names both ends of a passage and marks every line of it', () => {
    const message = withNotes(
      'why',
      [note({ line: 42, endLine: 44, code: 'const b = 2\nconst c = 3\nreturn c' })],
      INTROS
    )

    expect(message).toBe(
      'Review notes:\n\nsrc/core/diff.ts:42-44\n> const b = 2\n> const c = 3\n> return c\nThis should be 3.\n\nwhy'
    )
  })

  it('keeps several notes in the order they were written', () => {
    const message = withNotes(
      '',
      [note({ line: 1, text: 'first' }), note({ line: 2, text: 'second' })],
      INTROS
    )

    expect(message.indexOf('first')).toBeLessThan(message.indexOf('second'))
  })

  // The review can be the whole message, and a trailing blank line where the
  // typed text would have been is not part of it.
  it('sends the notes alone when nothing was typed', () => {
    expect(withNotes('', [note()], INTROS)).toBe(
      'Review notes:\n\nsrc/core/diff.ts:42\n> const b = 2\nThis should be 3.'
    )
  })

  // The line is kept from the moment the note was written: by the time the
  // agent reads it the file may have moved on, and a number alone would point
  // at whatever now sits there.
  it('quotes the line as it read when the note was written', () => {
    expect(withNotes('', [note({ code: 'the old text' })], INTROS)).toContain('> the old text')
  })
})

describe('writing a remark from the review into the message', () => {
  /*
   * The heading names who said it and where. A review comment without its
   * author is an anonymous instruction, and the reader is about to ask a
   * question about it rather than carry it out.
   */
  it('names the request, the author and the place', () => {
    expect(withNotes('what did they mean?', [remark()], INTROS)).toBe(
      'From the review:\n\n#812 — @olena — src/core/git.ts:42\n> @@ -1 +1 @@\n> -const a = 1\nWhy the second case?\n\nwhat did they mean?'
    )
  })

  // A comment on the request as a whole has no file, and a review carries only
  // a verdict — neither should leave an empty field or a dangling dash.
  it('leaves out what a remark does not have', () => {
    const message = withNotes('', [remark({ place: null, quote: null, author: null })], INTROS)

    expect(message).toBe('From the review:\n\n#812\nWhy the second case?')
  })

  /* One introduction per kind that is present. Two headings over a list of six
     is a shape; six headings is noise. */
  it('introduces each kind once, in its own group', () => {
    const message = withNotes('', [note(), remark(), note({ line: 9, endLine: 9 })], INTROS)

    expect(message.split('Review notes:')).toHaveLength(2)
    expect(message.split('From the review:')).toHaveLength(2)
    // Both of the diff's notes are above the review, whatever order they came in.
    expect(message.indexOf('src/core/diff.ts:9')).toBeLessThan(message.indexOf('#812'))
  })
  it('leaves a message with no notes exactly as it was typed', () => {
    expect(withNotes('rerun the tests', [], INTROS)).toBe('rerun the tests')
  })
})

/*
 * The whole of an attachment is its path, written where the reader is typing.
 * Nothing is copied anywhere and nothing is added in front of it: the message
 * read back in the log is the whole of what was sent.
 */
describe('writing a file pointed at into the draft', () => {
  it('writes it where the caret is, set apart from the words on either side', () => {
    expect(insertPaths('compare with', 7, ['/a/shot.png'])).toEqual({
      draft: 'compare /a/shot.png with',
      caret: 19
    })
  })

  it('adds no second space where there is one already', () => {
    expect(insertPaths('look at ', 8, ['/a/shot.png'])).toEqual({
      draft: 'look at /a/shot.png ',
      caret: 20
    })
    // Before a space, the caret stops ahead of it rather than past a new one.
    expect(insertPaths('see  please', 4, ['/a.png'])).toEqual({
      draft: 'see /a.png please',
      caret: 10
    })
  })

  it('stands alone in an empty field, with the caret ready for the next word', () => {
    expect(insertPaths('', 0, ['/a/shot.png'])).toEqual({ draft: '/a/shot.png ', caret: 12 })
  })

  it('writes several in the order they came, a space apart', () => {
    expect(insertPaths('', 0, ['/a.png', '/b.log']).draft).toBe('/a.png /b.log ')
  })

  /* Inside a sentence nothing else says where a name with spaces ends, and a
     path the agent cuts at the first space names a file that does not exist. */
  it('puts a path with a space in it in backticks', () => {
    expect(insertPaths('', 0, ['/Users/me/Desktop/Знімок екрана 18.57.56.png']).draft).toBe(
      '`/Users/me/Desktop/Знімок екрана 18.57.56.png` '
    )
  })

  // A caret left past the text — the draft shortened under it — writes at the end.
  it('writes at the end when the caret is past it', () => {
    expect(insertPaths('hi', 9, ['/a.png'])).toEqual({ draft: 'hi /a.png ', caret: 10 })
  })
})
