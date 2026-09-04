import { describe, expect, it } from 'vitest'

import type { DiffComment } from '../../hooks/useDiffComments.js'
import type { PullRequestQuote } from '../../hooks/usePullRequestQuotes.js'

import { type ChatNote, mergeNotes, noteKey, withNotes } from './attachments.js'

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
  it('keeps the two kinds in namespaces of their own', () => {
    const same = noteKey(note({ path: '7', line: 0, endLine: 0 }))

    expect(noteKey(remark({ key: '7' }))).not.toBe(same)
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

  it('answers with nothing when neither queue holds anything', () => {
    expect(mergeNotes([], [])).toEqual([])
  })
})

describe('writing the notes into the message', () => {
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
})
