import { describe, expect, it } from 'vitest'

import { colorFor, nextProjectColor, PROJECT_COLORS } from './colors.js'

describe('nextProjectColor', () => {
  it('starts at the top of the palette', () => {
    expect(nextProjectColor([])).toBe(PROJECT_COLORS[0])
  })

  it('skips colours already in use', () => {
    expect(nextProjectColor([PROJECT_COLORS[0]])).toBe(PROJECT_COLORS[1])
  })

  it('takes the first gap rather than the next one along', () => {
    const taken = [PROJECT_COLORS[1], PROJECT_COLORS[2]]
    expect(nextProjectColor(taken)).toBe(PROJECT_COLORS[0])
  })

  it('gives every project a distinct colour while the palette lasts', () => {
    const taken: string[] = []
    while (taken.length < PROJECT_COLORS.length) {
      const colour = nextProjectColor(taken)
      expect(taken).not.toContain(colour)
      taken.push(colour)
    }
  })

  // Eight projects is not a limit worth enforcing, and a repeated colour is a
  // mild annoyance next to refusing to add a project at all.
  it('wraps round once the palette is exhausted', () => {
    const taken = [...PROJECT_COLORS]
    expect(PROJECT_COLORS).toContain(nextProjectColor(taken))
  })

  // Otherwise every project past the eighth would pile onto the first colour.
  it('spreads duplicates instead of reusing one colour', () => {
    const taken = [...PROJECT_COLORS, PROJECT_COLORS[0]]
    expect(nextProjectColor(taken)).toBe(PROJECT_COLORS[1])
  })

  it('ignores a colour that is not in the palette', () => {
    expect(nextProjectColor(['chartreuse'])).toBe(PROJECT_COLORS[0])
  })
})

describe('colorFor', () => {
  it('answers the same colour for the same name, every time', () => {
    expect(colorFor('context7@claude-plugins-official')).toBe(
      colorFor('context7@claude-plugins-official')
    )
  })

  it('spreads names over the palette', () => {
    const names = Array.from({ length: 60 }, (_, index) => `plugin-${String(index)}@market`)

    expect(new Set(names.map(colorFor)).size).toBeGreaterThan(8)
    for (const name of names) expect(PROJECT_COLORS).toContain(colorFor(name))
  })
})
