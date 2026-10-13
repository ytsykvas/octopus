import { describe, expect, it } from 'vitest'

import { readMention, withoutMention } from './mentionMatch.js'

describe('reading a mention at the caret', () => {
  it('finds one at the start of the draft', () => {
    expect(readMention('@comp', 5)).toEqual({ query: 'comp', start: 0 })
  })

  it('finds one after a word', () => {
    expect(readMention('look at @auth', 13)).toEqual({ query: 'auth', start: 8 })
  })

  it('answers an empty query right after the @', () => {
    expect(readMention('see @', 5)).toEqual({ query: '', start: 4 })
  })

  // The draft goes on past the caret; what is typed there is not the query.
  it('reads up to the caret rather than to the end', () => {
    expect(readMention('fix @auth.ts please', 7)).toEqual({ query: 'au', start: 4 })
  })

  it('finds one on a later line', () => {
    expect(readMention('first\n@notes', 12)).toEqual({ query: 'notes', start: 6 })
  })

  // An email address is not a file.
  it('does not start inside a word', () => {
    expect(readMention('mail me@example', 15)).toBeNull()
  })

  it('is not there once a space ends the token', () => {
    expect(readMention('@auth.ts and', 12)).toBeNull()
  })

  it('is not there without an @', () => {
    expect(readMention('plain text', 10)).toBeNull()
  })
})

describe('taking the token out', () => {
  it('leaves the rest of the sentence as it was', () => {
    const draft = 'fix @auth please'
    const mention = readMention(draft, 9)

    expect(mention).not.toBeNull()
    expect(withoutMention(draft, mention ?? { query: '', start: 0 }, 9)).toBe('fix  please')
  })
})
