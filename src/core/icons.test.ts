import { describe, expect, it } from 'vitest'

import { PROJECT_ICONS, ProjectIconSchema } from './icons.js'

describe('PROJECT_ICONS', () => {
  // A duplicate would render twice in the picker and make one of the two
  // impossible to tell apart from the other once chosen.
  it('lists every icon once', () => {
    expect(new Set(PROJECT_ICONS).size).toBe(PROJECT_ICONS.length)
  })

  // The renderer keys its component map on these ids, so anything that is not
  // a plain kebab-case word invites a typo nothing would catch.
  it('names icons in kebab-case', () => {
    for (const icon of PROJECT_ICONS) expect(icon).toMatch(/^[a-z]+(-[a-z]+)*$/)
  })
})

describe('ProjectIconSchema', () => {
  it('accepts an icon from the list', () => {
    expect(ProjectIconSchema.parse('rocket')).toBe('rocket')
  })

  // An id the renderer has no component for would leave a hole in the strip.
  it('rejects an icon nothing can draw', () => {
    expect(ProjectIconSchema.safeParse('unicorn').success).toBe(false)
  })
})
