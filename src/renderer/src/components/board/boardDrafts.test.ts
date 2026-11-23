import { describe, expect, it } from 'vitest'

import { type DescriptionDraft, draftSlot, movedDraft, withDraft } from './boardDrafts.js'

const d: DescriptionDraft = { text: 'T', base: 'B' }

describe('draftSlot', () => {
  it('joins the project and the card', () => {
    expect(draftSlot('planner', 'backlog/a.md')).toBe('planner\nbacklog/a.md')
  })
})

describe('withDraft', () => {
  it('sets a draft', () => {
    expect(withDraft(new Map(), 's', { text: 'T', base: 'B' }).get('s')).toEqual({
      text: 'T',
      base: 'B'
    })
  })

  it('forgets a draft', () => {
    expect(withDraft(new Map([['s', d]]), 's', null).has('s')).toBe(false)
  })

  it('hands back the same map when there is nothing to forget', () => {
    const m = new Map<string, DescriptionDraft>()

    expect(withDraft(m, 's', null)).toBe(m)
  })
})

describe('movedDraft', () => {
  it('carries a draft to the new slot', () => {
    const moved = movedDraft(new Map([['a', d]]), 'a', 'b')

    expect(moved.get('b')).toBe(d)
    expect(moved.has('a')).toBe(false)
  })

  it('hands back the same map when there was no draft', () => {
    const m = new Map<string, DescriptionDraft>()

    expect(movedDraft(m, 'a', 'b')).toBe(m)
  })
})
