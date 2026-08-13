import { describe, expect, it } from 'vitest'

import {
  ASK_USER_QUESTION,
  type QuestionAnswer,
  QuestionAnswerSchema,
  readQuestions,
  type UserQuestions,
  withAnswers
} from './questions.js'

/**
 * A tool call as the agent makes one — copied from a live one rather than
 * written from the schema, so the shape is the tool's own rather than ours.
 */
const ASKED = {
  questions: [
    {
      question: 'Which library should we use for date formatting?',
      header: 'Library',
      multiSelect: false,
      options: [
        { label: 'date-fns', description: 'Tree-shakeable, no locale data by default' },
        { label: 'Luxon', description: 'Carries its own time zone handling' }
      ]
    }
  ]
}

function questions(): UserQuestions {
  const parsed = readQuestions(ASK_USER_QUESTION, ASKED)
  if (!parsed) throw new Error('the fixture should parse')
  return parsed
}

describe('reading a question out of a tool call', () => {
  it('reads the questions, their options and what each one means', () => {
    const parsed = readQuestions(ASK_USER_QUESTION, ASKED)

    expect(parsed?.questions).toHaveLength(1)
    expect(parsed?.questions[0]?.question).toBe('Which library should we use for date formatting?')
    expect(parsed?.questions[0]?.options[1]).toEqual({
      label: 'Luxon',
      description: 'Carries its own time zone handling'
    })
  })

  it('is not interested in any other tool', () => {
    expect(readQuestions('Bash', ASKED)).toBeNull()
  })

  /*
   * The model wrote this input, and it runs while the log is being drawn. A
   * malformed call has to fall back to the ordinary permission card rather than
   * take the conversation down with it.
   */
  it('gives up quietly on a call it cannot read', () => {
    expect(readQuestions(ASK_USER_QUESTION, { questions: [] })).toBeNull()
    expect(readQuestions(ASK_USER_QUESTION, { questions: 'a lot' })).toBeNull()
    expect(readQuestions(ASK_USER_QUESTION, {})).toBeNull()
    expect(readQuestions(ASK_USER_QUESTION, null)).toBeNull()
  })

  it('fills in what a terse question left out', () => {
    const parsed = readQuestions(ASK_USER_QUESTION, {
      questions: [{ question: 'Ship it?', options: [{ label: 'Yes' }, { label: 'No' }] }]
    })

    expect(parsed?.questions[0]?.header).toBe('')
    expect(parsed?.questions[0]?.multiSelect).toBe(false)
    expect(parsed?.questions[0]?.options[0]?.description).toBe('')
  })

  // "No preview" and "an empty preview" draw differently, so the field stays
  // absent rather than becoming an empty string.
  it('keeps a preview when there is one, and none when there is not', () => {
    const parsed = readQuestions(ASK_USER_QUESTION, {
      questions: [
        {
          question: 'Which layout?',
          options: [{ label: 'Split', preview: '| a | b |' }, { label: 'Stacked' }]
        }
      ]
    })

    expect(parsed?.questions[0]?.options[0]?.preview).toBe('| a | b |')
    expect(parsed?.questions[0]?.options[1]).not.toHaveProperty('preview')
  })

  /*
   * Deliberately more permissive than the tool's own schema, which allows at
   * most four questions and demands at least two options. Refusing a fifth
   * would take the whole card away — a worse failure than drawing five.
   */
  it('draws more than the tool promises rather than nothing', () => {
    const many = {
      questions: Array.from({ length: 5 }, (_, index) => ({
        question: `Question ${String(index)}?`,
        options: [{ label: 'Only choice' }]
      }))
    }

    expect(readQuestions(ASK_USER_QUESTION, many)?.questions).toHaveLength(5)
  })
})

describe('writing the answers back into the call', () => {
  function answer(overrides: Partial<QuestionAnswer> = {}): QuestionAnswer {
    return {
      question: 'Which library should we use for date formatting?',
      selected: [],
      other: null,
      ...overrides
    }
  }

  it('keys the answer by the question, as the tool reads it', () => {
    const answered = withAnswers(questions(), [answer({ selected: ['date-fns'] })])

    expect(answered.answers).toEqual({
      'Which library should we use for date formatting?': 'date-fns'
    })
  })

  // The CLI's own separator: it writes several answers this way and splits them
  // back on exactly this string.
  it('joins several choices the way the agent reads them apart', () => {
    const answered = withAnswers(questions(), [answer({ selected: ['date-fns', 'Luxon'] })])

    expect(answered.answers).toEqual({
      'Which library should we use for date formatting?': 'date-fns, Luxon'
    })
  })

  /*
   * Free text goes in beside the labels rather than into a field of its own.
   * Measured against the CLI: its branch for a separate `response` discards the
   * list answers entirely, so anything ticked would vanish the moment something
   * was also typed.
   */
  it('sends what the user wrote alongside what they ticked', () => {
    const answered = withAnswers(questions(), [
      answer({ selected: ['date-fns'], other: 'or Temporal once it lands' })
    ])

    expect(answered.answers).toEqual({
      'Which library should we use for date formatting?': 'date-fns, or Temporal once it lands'
    })
  })

  it('sends free text on its own when nothing was ticked', () => {
    const answered = withAnswers(questions(), [answer({ other: 'neither, write it by hand' })])

    expect(answered.answers).toEqual({
      'Which library should we use for date formatting?': 'neither, write it by hand'
    })
  })

  // An empty string would read as an answer that says nothing; the tool has to
  // see the question as unanswered instead.
  it('leaves an unanswered question out altogether', () => {
    expect(withAnswers(questions(), [answer()]).answers).toEqual({})
    expect(withAnswers(questions(), [answer({ other: '   ' })]).answers).toEqual({})
    expect(withAnswers(questions(), []).answers).toEqual({})
  })

  /*
   * The whole reason the schema is loose. The answer goes back as a copy of the
   * tool's own input, and it carries fields we have no business knowing about —
   * a strict schema would drop them here, silently.
   */
  it('carries back the fields it never looked at', () => {
    const parsed = readQuestions(ASK_USER_QUESTION, {
      ...ASKED,
      metadata: { source: 'remember' }
    })
    if (!parsed) throw new Error('the fixture should parse')

    const answered = withAnswers(parsed, [answer({ selected: ['Luxon'] })])

    expect(answered.metadata).toEqual({ source: 'remember' })
    expect(answered.questions).toHaveLength(1)
  })
})

describe('an answer as the renderer may send it', () => {
  it('needs only the question it answers', () => {
    const parsed = QuestionAnswerSchema.safeParse({ question: 'Ship it?' })

    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ question: 'Ship it?', selected: [], other: null })
  })

  // It reaches the agent as text, which makes it a prompt — bounded like the
  // plan feedback for the same reason.
  it('refuses free text longer than a prompt', () => {
    expect(
      QuestionAnswerSchema.safeParse({ question: 'Ship it?', other: 'x'.repeat(10_001) }).success
    ).toBe(false)
  })

  it('refuses an answer to no question at all', () => {
    expect(QuestionAnswerSchema.safeParse({ question: '' }).success).toBe(false)
  })
})
