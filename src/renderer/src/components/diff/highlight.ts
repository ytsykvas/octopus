/**
 * Syntax colours for the lines of a diff.
 *
 * Deliberately thin. Everything that can be decided without a highlighter —
 * which grammar a path uses, how the two sides of a file are rebuilt — lives
 * beside this in modules that need nothing loaded to be tested.
 */

import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRawEngine } from 'shiki/engine/javascript'

import { GRAMMARS, type Language } from './grammars.js'

/**
 * One piece of a line, with the colour each theme gives it.
 *
 * A colour may be absent, and nothing here invents one: the custom property is
 * simply not set, and `.diff-code` in the stylesheet falls back to `--ink`.
 */
export interface Token {
  readonly text: string
  readonly light: string | undefined
  readonly dark: string | undefined
}

/**
 * The themes, chosen to sit on our own canvas rather than to bring their own.
 *
 * Both are loaded at once and `defaultColor: false` makes shiki emit a pair of
 * custom properties per token, so the stylesheet picks between them under
 * `.dark` and nothing is tokenised twice when the theme changes.
 */
const LIGHT = 'github-light'
const DARK = 'github-dark'

/*
 * Created once, on the first diff that needs it.
 *
 * Held as the promise rather than the highlighter so that several files asking
 * at once share one construction instead of racing to build several.
 */
let starting: Promise<HighlighterCore> | null = null

const loaded = new Set<string>()

async function highlighter(): Promise<HighlighterCore> {
  starting ??= (async () => {
    const [light, dark] = await Promise.all([
      import('@shikijs/themes/github-light'),
      import('@shikijs/themes/github-dark')
    ])

    return createHighlighterCore({
      langs: [],
      themes: [light.default, dark.default],
      // The JavaScript engine over precompiled grammars, rather than the
      // oniguruma one: no WASM asset to load from a `file://` renderer, and
      // nothing for the test environment to instantiate.
      engine: createJavaScriptRawEngine()
    })
  })()

  return starting
}

/**
 * Loads a grammar the first time a file needs it.
 *
 * Answers false when there is no such grammar rather than throwing: an
 * unhighlighted diff is a smaller loss than a pane that fails to draw.
 */
async function ensureLanguage(core: HighlighterCore, language: Language): Promise<boolean> {
  if (loaded.has(language)) return true

  try {
    const grammar = await GRAMMARS[language]()
    await core.loadLanguage(grammar.default)
    loaded.add(language)
    return true
  } catch {
    return false
  }
}

/**
 * Colours a document, one array of tokens per line.
 *
 * A whole side of the file at once rather than line by line: a block comment or
 * a template literal spanning several lines is coloured wrongly if each line is
 * tokenised alone, and the lines of a hunk are exactly where that happens.
 *
 * Answers null when there is nothing to say — no grammar for this path, or a
 * highlighter that would not start — and the caller draws the code plain.
 */
export async function highlight(language: Language, code: string): Promise<Token[][] | null> {
  try {
    const core = await highlighter()
    if (!(await ensureLanguage(core, language))) return null

    const { tokens } = core.codeToTokens(code, {
      lang: language,
      themes: { light: LIGHT, dark: DARK },
      defaultColor: false
    })

    return tokens.map((line) =>
      line.map((token) => ({
        text: token.content,
        light: token.htmlStyle?.['--shiki-light'],
        dark: token.htmlStyle?.['--shiki-dark']
      }))
    )
  } catch {
    // A highlighter that will not start is a missing courtesy, not a failure
    // worth taking the diff down for.
    return null
  }
}
