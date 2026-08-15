import { describe, expect, it } from 'vitest'

import { readFailure } from './toolFailure.js'

describe('readFailure', () => {
  it('leaves a short message exactly as it came', () => {
    expect(readFailure('no such file')).toBe('no such file')
  })

  // The envelope belongs to the agent side, not to the conversation.
  it('takes the wrapper off', () => {
    expect(readFailure('<tool_use_error>no such file</tool_use_error>')).toBe('no such file')
  })

  // An unclosed tag reads as broken output rather than as an envelope, and is
  // what arrives when something upstream has already shortened the message.
  it('takes off an opening tag with no closing one', () => {
    expect(readFailure('<tool_use_error>no such file')).toBe('no such file')
  })

  it('leaves a message that merely mentions the tag alone', () => {
    expect(readFailure('the output held a <tool_use_error> marker')).toBe(
      'the output held a <tool_use_error> marker'
    )
  })

  /*
   * The case this was written for: a validation error names the rule at the
   * start and says what to do at the end, and the log used to show the first
   * 400 characters of it with nothing to say it had stopped — so the sentence
   * that answered "and now what" was the half that went.
   */
  it('keeps both ends of a long message and marks the gap', () => {
    const message = `InputValidationError: ${'x'.repeat(900)} Make sure each question has two choices.`

    const shown = readFailure(message)

    expect(shown.startsWith('InputValidationError:')).toBe(true)
    expect(shown.endsWith('Make sure each question has two choices.')).toBe(true)
    expect(shown).toContain('…')
  })

  it('shortens to something a pane can hold', () => {
    // Bounded rather than exact: the two halves and the gap need not add up to
    // the ceiling, only stay under it.
    expect(readFailure('x'.repeat(5000)).length).toBeLessThanOrEqual(400)
  })

  it('leaves a message at the limit whole', () => {
    const message = 'x'.repeat(400)

    expect(readFailure(message)).toBe(message)
  })
})
