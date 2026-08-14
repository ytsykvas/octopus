/**
 * Driven against the real highlighter.
 *
 * Everything around it is pure and tested on its own; what is left here is the
 * one thing a stand-in could not tell us — that shiki starts under this build,
 * with the engine and the grammars we actually ship, and answers in the shape
 * the rows are drawn from.
 */

import { describe, expect, it } from 'vitest'

import { GRAMMARS } from './grammars.js'
import { highlight } from './highlight.js'
import { languageFor } from './language.js'

describe('highlight', () => {
  it('breaks a line into the pieces its language gives it', async () => {
    const tokens = await highlight('typescript', 'const x = 1')

    expect(tokens?.[0]?.length).toBeGreaterThan(1)
    expect(tokens?.[0]?.map((token) => token.text).join('')).toBe('const x = 1')
  })

  // One tokenising serves both themes: the stylesheet picks between the two
  // custom properties under `.dark`, so a theme change repaints nothing.
  it('gives every piece a colour for each theme', async () => {
    const tokens = await highlight('typescript', 'const x = 1')
    const first = tokens?.[0]?.[0]

    expect(first?.light).toMatch(/^#/)
    expect(first?.dark).toMatch(/^#/)
    expect(first?.light).not.toBe(first?.dark)
  })

  it('answers one row of pieces per line', async () => {
    const tokens = await highlight('typescript', 'const a = 1\nconst b = 2')

    expect(tokens).toHaveLength(2)
  })

  // The whole reason a side is tokenised at once rather than line by line.
  it('keeps a comment open across the lines it spans', async () => {
    const tokens = await highlight('typescript', '/*\nstill a comment\n*/')
    const middle = tokens?.[1]?.[0]

    const alone = await highlight('typescript', 'still a comment')
    expect(middle?.light).not.toBe(alone?.[0]?.[0]?.light)
  })

  it('loads a second grammar without disturbing the first', async () => {
    await highlight('typescript', 'const x = 1')
    const css = await highlight('css', 'a { color: red }')

    expect(css?.[0]?.length).toBeGreaterThan(1)
  })

  it('has a grammar for every language a path can resolve to', () => {
    for (const path of [
      'a.ts',
      'a.tsx',
      'a.js',
      'a.json',
      'a.css',
      'a.md',
      'a.sh',
      'a.yml',
      'a.py',
      'Dockerfile',
      'Makefile',
      '.gitignore'
    ]) {
      const language = languageFor(path)
      expect(language).not.toBeNull()
      expect(language !== null && language in GRAMMARS).toBe(true)
    }
  })
})
