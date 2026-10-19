/*
 * That "Reduce motion" stops every animation in the window, not a list of them.
 *
 * Read as text because nothing else can see it: the stylesheet is compiled by
 * Tailwind and evaluated by no test, and jsdom answers no media query. This is
 * what notices the rule being narrowed back to a list of selectors.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const STYLES = join(import.meta.dirname, 'styles.css')

describe('an animation in the window', () => {
  it('stops for anybody who asked the system for less motion', () => {
    // Comments out first: a rule commented away must not count as one.
    const css = readFileSync(STYLES, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')

    expect(css).toContain(
      '@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation: none !important; } }'
    )
  })
})
