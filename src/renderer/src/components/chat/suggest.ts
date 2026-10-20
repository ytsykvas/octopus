/**
 * What the composer should be suggesting, read from the draft at the caret.
 *
 * Kept out of the component and free of React so every decision about *when* a
 * list appears can be tested against strings. One reader serves both lists:
 * `/` offers commands and skills, `@` offers subagents, and they differ only in
 * the character that opens them and in what is offered.
 */

/** A word being typed after a `/` or an `@`. */
export interface Trigger {
  /** What follows the sigil up to the caret; empty right after typing it. */
  readonly query: string
  /** Where the sigil is, so the whole token can be replaced. */
  readonly start: number
}

export type Sigil = '/' | '@'

/*
 * Read at the caret rather than at the end of the draft, because the word may
 * sit anywhere in a sentence — "use /review on this" — and only when the sigil
 * starts a word. Matching mid-word would open a list inside `src/core/`, an
 * email address or a pasted path, which is worse than offering none.
 *
 * Names come from directories, skill names and agent types, so the characters
 * allowed are the ones those produce: letters, digits, `_`, `-` and the `:` that
 * qualifies a plugin's.
 */
const TRIGGERS: Readonly<Record<Sigil, RegExp>> = {
  '/': /(?:^|\s)\/([\w:-]*)$/,
  '@': /(?:^|\s)@([\w:-]*)$/
}

/** The word being typed at the caret after `sigil`, or null when there is none. */
export function readTrigger(draft: string, caret: number, sigil: Sigil): Trigger | null {
  const query = TRIGGERS[sigil].exec(draft.slice(0, caret))?.[1]
  if (query === undefined) return null

  return { query, start: caret - query.length - 1 }
}

interface Named {
  readonly name: string
  readonly aliases?: readonly string[]
}

/**
 * How well an entry answers what has been typed, lower being better.
 *
 * Three tiers, because they are what a reader expects in order: what starts
 * with these letters, then what is *called* something else but answers to
 * them, then what merely contains them. `null` is no match at all.
 *
 * Descriptions are deliberately not searched. They are sentences — `/cost`
 * appears in the text of several unrelated commands — and a list that answers
 * a two-letter prefix with everything is a list nobody reads.
 */
function rank(entry: Named, query: string): number | null {
  if (entry.name.startsWith(query)) return 0
  if (entry.aliases?.some((alias) => alias.startsWith(query))) return 1
  if (entry.name.includes(query)) return 2
  return null
}

/**
 * The entries worth offering for a query, best first.
 *
 * Stable within a tier: the agent reports its lists in an order it chose, and
 * re-sorting alphabetically would scatter related entries. One that matches by
 * both its name and an alias appears once, at its better rank.
 */
export function rankByName<T extends Named>(entries: readonly T[], query: string): readonly T[] {
  return entries
    .map((entry) => ({ entry, rank: rank(entry, query) }))
    .filter((scored): scored is { entry: T; rank: number } => scored.rank !== null)
    .sort((left, right) => left.rank - right.rank)
    .map((scored) => scored.entry)
}

/**
 * The draft with the token at the caret replaced, and where the caret goes.
 *
 * The caret lands after the inserted text, so the next key continues from
 * where the pick left off — wherever in the sentence that was.
 */
export function replaceToken(
  draft: string,
  token: Trigger,
  caret: number,
  text: string
): { readonly draft: string; readonly caret: number } {
  return {
    draft: draft.slice(0, token.start) + text + draft.slice(caret),
    caret: token.start + text.length
  }
}

/**
 * What a picked command becomes in the text.
 *
 * At the start of a message it is the command itself, with a trailing space
 * only when it takes arguments: the space is where they are typed, and one
 * after a command that takes nothing would have to be deleted before sending.
 * Mid-sentence it is a word like any other, and the sentence goes on after it.
 */
export function commandText(
  command: { readonly name: string; readonly argumentHint: string },
  leading: boolean
): string {
  return leading && command.argumentHint === '' ? `/${command.name}` : `/${command.name} `
}
