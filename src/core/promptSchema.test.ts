import { describe, expect, it } from 'vitest'

import {
  firstLine,
  PROMPT_TEXT_MAX,
  PROMPT_TITLE_MAX,
  PromptDraftSchema,
  PromptFileSchema,
  PromptIdSchema,
  PromptSchema
} from './promptSchema.js'

const ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b'

describe('PromptDraftSchema', () => {
  it('trims the title and the text', () => {
    expect(PromptDraftSchema.parse({ title: '  Review  ', text: '\n do it \n' })).toEqual({
      title: 'Review',
      text: 'do it',
      forPlan: false
    })
  })

  it('refuses a title or a text that is empty once trimmed', () => {
    expect(PromptDraftSchema.safeParse({ title: '   ', text: 'x' }).success).toBe(false)
    expect(PromptDraftSchema.safeParse({ title: 'x', text: ' \n ' }).success).toBe(false)
  })

  // The title sits on a pill in the fan, so its limit is a layout limit.
  it('refuses a title one character over the limit and a text likewise', () => {
    expect(
      PromptDraftSchema.safeParse({ title: 'x'.repeat(PROMPT_TITLE_MAX), text: 'x' }).success
    ).toBe(true)
    expect(
      PromptDraftSchema.safeParse({ title: 'x'.repeat(PROMPT_TITLE_MAX + 1), text: 'x' }).success
    ).toBe(false)
    expect(
      PromptDraftSchema.safeParse({ title: 'x', text: 'x'.repeat(PROMPT_TEXT_MAX) }).success
    ).toBe(true)
    expect(
      PromptDraftSchema.safeParse({ title: 'x', text: 'x'.repeat(PROMPT_TEXT_MAX + 1) }).success
    ).toBe(false)
  })

  it('keeps forPlan when it is given', () => {
    expect(PromptDraftSchema.parse({ title: 'a', text: 'b', forPlan: true }).forPlan).toBe(true)
  })
})

describe('PromptIdSchema', () => {
  it('accepts a uuid and refuses anything else', () => {
    expect(PromptIdSchema.safeParse(ID).success).toBe(true)
    expect(PromptIdSchema.safeParse('x').success).toBe(false)
    expect(PromptSchema.safeParse({ id: 'x', title: 'a', text: 'b', forPlan: false }).success).toBe(
      false
    )
  })
})

describe('PromptFileSchema', () => {
  it('reads a file with no prompts key as an empty list', () => {
    expect(PromptFileSchema.parse({ version: 1 })).toEqual({ version: 1, prompts: [] })
  })

  it('refuses another version', () => {
    expect(PromptFileSchema.safeParse({ version: 2, prompts: [] }).success).toBe(false)
  })
})

describe('firstLine', () => {
  it('is the first line with words in it, trimmed', () => {
    expect(firstLine('\n\n  a\nb')).toBe('a')
  })

  it('is empty for an empty text', () => {
    expect(firstLine('')).toBe('')
  })
})
