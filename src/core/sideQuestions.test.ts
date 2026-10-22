import { describe, expect, it } from 'vitest'

import {
  formatAside,
  parseBtw,
  SideHistorySchema,
  SIDE_HISTORY_LIMIT,
  SideQuestionSchema
} from './sideQuestions'

describe('parseBtw', () => {
  it('takes the question after the command', () => {
    expect(parseBtw('/btw what does this flag do?')).toEqual({
      question: 'what does this flag do?'
    })
  })

  it('matches whatever case the command is typed in', () => {
    expect(parseBtw('/BTW why')).toEqual({ question: 'why' })
  })

  // A question pasted over several lines is still one question.
  it('keeps the lines of a question that runs over several', () => {
    expect(parseBtw('  /btw first\nsecond  ')).toEqual({ question: 'first\nsecond' })
  })

  it('reads a bare command as an empty question', () => {
    expect(parseBtw('/btw')).toEqual({ question: '' })
    expect(parseBtw('/btw   ')).toEqual({ question: '' })
  })

  it('leaves alone a command that only starts the same way', () => {
    expect(parseBtw('/btwx why')).toBeNull()
  })

  // Only at the start: mid-sentence it is part of an ordinary message.
  it('leaves alone a message that mentions it later', () => {
    expect(parseBtw('what does /btw do')).toBeNull()
  })
})

describe('what crosses the bridge', () => {
  it('refuses a question with nothing in it', () => {
    expect(SideQuestionSchema.safeParse('  ').success).toBe(false)
    expect(SideQuestionSchema.parse(' why ')).toBe('why')
  })

  it('refuses a thread longer than the CLI replays', () => {
    const exchange = { question: 'q', response: 'a' }

    expect(SideHistorySchema.safeParse(Array(SIDE_HISTORY_LIMIT).fill(exchange)).success).toBe(true)
    expect(SideHistorySchema.safeParse(Array(SIDE_HISTORY_LIMIT + 1).fill(exchange)).success).toBe(
      false
    )
  })
})

describe('formatAside', () => {
  const text = formatAside({ question: 'why?', response: 'Because.' }, 'go on')

  it('puts the exchange before the message', () => {
    expect(text.indexOf('why?')).toBeLessThan(text.indexOf('Because.'))
    expect(text.indexOf('Because.')).toBeLessThan(text.indexOf('go on'))
  })

  it('ends with the message itself', () => {
    expect(text.endsWith('go on')).toBe(true)
  })
})
