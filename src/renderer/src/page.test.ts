/*
 * That the page itself can never scroll, from script included.
 *
 * Read as text for the reason `motion.test.ts` gives: the stylesheet is
 * evaluated by no test, and jsdom lays nothing out. `overflow: hidden` here
 * once let a `scrollIntoView` scroll `#root` into thousands of pixels of
 * nothing — the whole window moved up and stayed there.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const STYLES = join(import.meta.dirname, 'styles.css')

describe('the page under the panes', () => {
  it('clips instead of hiding, so nothing can scroll it', () => {
    // Comments out first: a rule commented away must not count as one.
    const css = readFileSync(STYLES, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')

    expect(css).toContain('body, #root { overflow: clip; }')
  })
})
