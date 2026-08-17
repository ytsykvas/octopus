import { describe, expect, it } from 'vitest'

import type { DiffComment } from '../../hooks/useDiffComments.js'

import { withComments } from './attachments.js'

const note = (overrides: Partial<DiffComment> = {}): DiffComment => ({
  path: 'src/core/diff.ts',
  side: 'new',
  line: 42,
  endLine: 42,
  code: 'const b = 2',
  text: 'This should be 3.',
  ...overrides
})

describe('withComments', () => {
  it('leaves a message with no notes exactly as it was typed', () => {
    expect(withComments('rerun the tests', [], 'Review notes:')).toBe('rerun the tests')
  })

  // Nothing implicit reaches the agent (§4): what goes out is the message the
  // user can read back in the log.
  it('writes each note into the message, with the line it is about', () => {
    const message = withComments('fix these', [note()], 'Review notes:')

    expect(message).toBe(
      'Review notes:\n\nsrc/core/diff.ts:42\n> const b = 2\nThis should be 3.\n\nfix these'
    )
  })

  /*
   * A passage names both ends and quotes every line of itself. One `>` and then
   * bare lines would read as a quote that ended and a message that began, which
   * is the confusion the marker exists to prevent.
   */
  it('names both ends of a passage and marks every line of it', () => {
    const message = withComments(
      'why',
      [note({ line: 42, endLine: 44, code: 'const b = 2\nconst c = 3\nreturn c' })],
      'Review notes:'
    )

    expect(message).toBe(
      'Review notes:\n\nsrc/core/diff.ts:42-44\n> const b = 2\n> const c = 3\n> return c\nThis should be 3.\n\nwhy'
    )
  })

  it('keeps several notes in the order they were written', () => {
    const message = withComments(
      '',
      [note({ line: 1, text: 'first' }), note({ line: 2, text: 'second' })],
      'Review notes:'
    )

    expect(message.indexOf('first')).toBeLessThan(message.indexOf('second'))
  })

  // The review can be the whole message, and a trailing blank line where the
  // typed text would have been is not part of it.
  it('sends the notes alone when nothing was typed', () => {
    expect(withComments('', [note()], 'Review notes:')).toBe(
      'Review notes:\n\nsrc/core/diff.ts:42\n> const b = 2\nThis should be 3.'
    )
  })

  // The line is kept from the moment the note was written: by the time the
  // agent reads it the file may have moved on, and a number alone would point
  // at whatever now sits there.
  it('quotes the line as it read when the note was written', () => {
    expect(withComments('', [note({ code: 'the old text' })], 'Review notes:')).toContain(
      '> the old text'
    )
  })
})
