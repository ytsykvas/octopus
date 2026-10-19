import { Fragment, useEffect, useState } from 'react'

import { highlight, type Token } from './highlight.js'
import { languageFor } from './language.js'
import { MAX_LINE_LENGTH } from './useHighlighting.js'

/**
 * Past these a text is drawn plain.
 *
 * The highlighter runs in the window's own thread, and a large text freezes it
 * for as long as tokenising takes — longer than it is worth for code being read
 * rather than edited. Lines are the diff's own limit: a minified bundle is a
 * few enormous lines, and those are the slow ones.
 */
export const MAX_HIGHLIGHT_CHARS = 256_000
export const MAX_HIGHLIGHT_LINES = 20_000

/** A text's lines as a `<pre>` shows them: a final newline ends the last line. */
function linesOf(text: string): string[] {
  return text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
}

export interface ColouredText {
  readonly lines: readonly string[]
  /** The colours, once the highlighter has them; null until then, and for good when there are none to have. */
  readonly tokens: readonly (readonly Token[])[] | null
  /** Whether a text that has a grammar is drawn plain for its size. */
  readonly tooLarge: boolean
}

/**
 * A text from a file, coloured by the file's grammar once the highlighter has it.
 *
 * Plain first rather than waiting: the text is readable the moment it is drawn,
 * and the colours land a moment later without anything moving. Colours for a
 * text no longer showing are dropped, so a file reloaded while it was being
 * tokenised never shows the old file's colours over the new one's lines.
 */
export function useColouredText(path: string, text: string): ColouredText {
  const lines = linesOf(text)
  const language = languageFor(path)
  const colourable =
    language !== null &&
    text.length <= MAX_HIGHLIGHT_CHARS &&
    lines.length <= MAX_HIGHLIGHT_LINES &&
    lines.every((line) => line.length <= MAX_LINE_LENGTH)

  const [coloured, setColoured] = useState<{ text: string; tokens: Token[][] } | null>(null)

  useEffect(() => {
    if (!colourable) return
    let current = true
    void highlight(language, text).then((found) => {
      if (current && found !== null) setColoured({ text, tokens: found })
    })
    return () => {
      current = false
    }
  }, [colourable, language, text])

  return {
    lines,
    tokens: coloured?.text === text ? coloured.tokens : null,
    tooLarge: language !== null && !colourable
  }
}

/**
 * The lines, coloured where there are tokens, joined the way a `<pre>` shows
 * them.
 *
 * Belongs inside an element with `diff-code`, which is what lets the stylesheet
 * pick each span's colour for the theme: shiki sets `--shiki-light` and
 * `--shiki-dark` on every token, so one tokenising serves both.
 */
export function ColouredLines({
  lines,
  tokens
}: Pick<ColouredText, 'lines' | 'tokens'>): React.JSX.Element {
  if (tokens === null) return <>{lines.join('\n')}</>

  return (
    <>
      {tokens.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && '\n'}
          {line.map((token, at) => (
            <span
              key={at}
              style={
                {
                  '--shiki-light': token.light,
                  '--shiki-dark': token.dark
                } as React.CSSProperties
              }
            >
              {token.text}
            </span>
          ))}
        </Fragment>
      ))}
    </>
  )
}
