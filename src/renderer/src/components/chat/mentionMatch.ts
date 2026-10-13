/**
 * Which file the composer should be suggesting, if any.
 *
 * Kept out of the component and free of React, like `commandMatch.ts`, so every
 * decision about *when* the list appears can be tested against strings.
 *
 * Unlike a command, a mention may sit anywhere in the draft — the whole point
 * is "look at @auth.ts and fix the expiry" — so it is read at the **caret**, not
 * at the end, and only when the `@` starts a word. Matching mid-word would
 * offer files inside an email address, which is worse than offering none.
 */

export interface Mention {
  /** What follows the `@` up to the caret; empty right after typing it. */
  readonly query: string
  /** Where the `@` is, so the whole token can be taken out. */
  readonly start: number
}

const MENTION = /(?:^|\s)@([^\s@]*)$/

/** The mention being typed at the caret, or null when there is none. */
export function readMention(draft: string, caret: number): Mention | null {
  const query = MENTION.exec(draft.slice(0, caret))?.[1]
  if (query === undefined) return null

  return { query, start: caret - query.length - 1 }
}

/**
 * The draft with the token taken out.
 *
 * The file does not stay in the text: it rides out as an attachment, which is
 * what the message names and what the chip above the field shows. Leaving
 * `@src/a.ts` in the prose as well would say it twice.
 */
export function withoutMention(draft: string, mention: Mention, caret: number): string {
  return draft.slice(0, mention.start) + draft.slice(caret)
}
