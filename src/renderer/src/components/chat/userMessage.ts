/**
 * A sent message read back into what it was made of, so the log can draw notes
 * on code as cards and references as chips rather than as the characters the
 * agent was sent.
 *
 * The message itself is never changed: what was sent is what the agent read,
 * and §4 wants the log to show exactly that. This only decides how it is drawn,
 * and anything not recognised is drawn as text, the way every message was
 * before — a parser that guessed would turn somebody's prose into a card.
 */

/** A reference to lines of a file, inside running text. */
export interface InlineReference {
  readonly path: string
  /** `12` or `12-18`, as written. */
  readonly range: string
}

export type Inline = string | InlineReference

export type MessageBlock =
  | { readonly kind: 'text'; readonly parts: readonly Inline[] }
  | {
      readonly kind: 'note'
      readonly path: string
      readonly range: string
      /** What followed the range on its line — the diff's "(as it was)". */
      readonly suffix: string | null
      readonly quote: string
      readonly text: string
    }

/**
 * The first line of a note as `withNotes` writes it: a path with no spaces,
 * its lines, and possibly a remark on which side of the diff they are from.
 */
const HEADING = /^(\S+):(\d+(?:-\d+)?)(?: (.+))?$/

/**
 * A reference inside a sentence. The path has to look like one — a folder or
 * an extension — so `10:30` stays a time; and nothing may run into either end,
 * so a URL's `host:port` after `//` stays part of the URL.
 */
const REFERENCE =
  /(?<![\w/.:-])((?:[\w.@~-]+\/)*[\w@~-][\w.@~-]*\.[A-Za-z]\w*|(?:[\w.@~-]+\/)+[\w.@~-]+):(\d+(?:-\d+)?)(?![\w:])/g

/** Whether a line belongs to a quote: `> ` and what follows, or a bare `>`. */
function quoted(line: string | undefined): line is string {
  return line !== undefined && (line.startsWith('> ') || line === '>')
}

/** Whether a line carries words — a note's remark ends at the first that does not. */
function written(line: string | undefined): line is string {
  return line !== undefined && line !== ''
}

/** Running text, with each reference in it picked out. */
export function inlineParts(text: string): Inline[] {
  const parts: Inline[] = []
  let from = 0

  for (const match of text.matchAll(REFERENCE)) {
    const [whole, path, range] = match
    /* v8 ignore next */
    if (path === undefined || range === undefined) continue
    if (match.index > from) parts.push(text.slice(from, match.index))
    parts.push({ path, range })
    from = match.index + whole.length
  }

  if (from < text.length) parts.push(text.slice(from))
  return parts
}

/** The message as blocks of text and notes, in order. */
export function messageBlocks(message: string): MessageBlock[] {
  // Read off the front, so taking a note's quote and remark is taking lines.
  const rest = message.split('\n')
  const blocks: MessageBlock[] = []
  let prose: string[] = []

  // The blank lines that separate a note from its neighbours are spacing, which
  // the card draws for itself; inside a run of text they stay.
  const flush = (): void => {
    const text = prose.join('\n').replace(/^\n+|\n+$/g, '')
    prose = []
    if (text !== '') blocks.push({ kind: 'text', parts: inlineParts(text) })
  }

  for (let line = rest.shift(); line !== undefined; line = rest.shift()) {
    const heading = HEADING.exec(line)

    // A heading only counts with its quote under it: `see src/a.ts:12` alone
    // on a line is a sentence, and the quote is what makes it a note.
    if (heading === null || !quoted(rest[0])) {
      prose.push(line)
      continue
    }

    const [, path = '', range = '', suffix] = heading
    const quote: string[] = []
    for (let next = rest[0]; quoted(next); next = rest[0]) {
      quote.push(next.slice(2))
      rest.shift()
    }

    // The remark runs to the next blank line, which is where `withNotes`
    // separates one note from the next.
    const remark: string[] = []
    for (let next = rest[0]; written(next); next = rest[0]) {
      remark.push(next)
      rest.shift()
    }

    flush()
    blocks.push({
      kind: 'note',
      path,
      range,
      suffix: suffix ?? null,
      quote: quote.join('\n'),
      text: remark.join('\n')
    })
  }

  flush()
  return blocks
}
