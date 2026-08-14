import { describe, expect, it } from 'vitest'

import { GRAMMARS } from './grammars.js'

/**
 * Every loader is opened for real.
 *
 * A subpath that does not resolve is otherwise invisible: `ensureLanguage`
 * catches the failure on purpose, so a typo here would quietly leave one
 * language uncoloured for ever with nothing on screen to say so. Twenty-eight
 * grammars cost about a third of a second between them.
 */
describe('the grammars the diff can reach for', () => {
  it.each(Object.entries(GRAMMARS))('has a grammar behind %s', async (name, load) => {
    const grammar = await load()

    // shiki ships each grammar as an array of one, or of a base plus the
    // embedded languages it needs; what matters is that the key names one of
    // them, since that is what `codeToTokens` is later asked for.
    const names = grammar.default.map((entry) => entry.name)
    expect(names).toContain(name)
  })
})
