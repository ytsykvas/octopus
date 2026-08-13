/**
 * Which command the composer should be suggesting, and which ones match.
 *
 * Kept out of the component and free of React so it can be tested against
 * strings — the same arrangement as `toolSummary.ts`. Every decision about
 * *when* the suggestion list appears lives here rather than in a condition
 * inside the field's key handler, where it would be impossible to read.
 */

import type { AgentCommand } from '@core/chats.js'

/**
 * A draft that is nothing but the beginning of a command.
 *
 * The whole draft, not its first word: `/` opens the list, and anything after
 * the name — a space, an argument, a second line — closes it again. Matching
 * mid-text instead would offer completions inside `src/core/`, in a date, or
 * in a path the user is pasting, which is worse than offering none.
 *
 * Command names come from directories and skill names, so the characters
 * allowed are the ones those produce: letters, digits, `_`, `-` and the `:`
 * that qualifies a plugin's command.
 */
const COMMAND_DRAFT = /^\/([\w:-]*)$/

/**
 * The name being typed, or null when the draft is not a command being typed.
 *
 * A bare `/` returns the empty string — a real answer, meaning "every command
 * matches" — which is why this is null-or-string rather than just falsy.
 */
export function readCommandQuery(draft: string): string | null {
  const found = COMMAND_DRAFT.exec(draft)
  return found?.[1] ?? null
}

/**
 * How well a command answers what has been typed, lower being better.
 *
 * Three tiers, because they are what a reader expects in order: what starts
 * with these letters, then what is *called* something else but answers to
 * them, then what merely contains them. `null` is no match at all.
 *
 * Descriptions are deliberately not searched. They are sentences — `/cost`
 * appears in the text of several unrelated commands — and a list that answers
 * a two-letter prefix with everything is a list nobody reads.
 */
function rank(command: AgentCommand, query: string): number | null {
  if (command.name.startsWith(query)) return 0
  if (command.aliases.some((alias) => alias.startsWith(query))) return 1
  if (command.name.includes(query)) return 2
  return null
}

/**
 * The commands worth offering for a query, best first.
 *
 * Stable within a tier: the agent reports its own list in an order it chose,
 * and re-sorting alphabetically would scatter related commands. A command that
 * matches by both its name and an alias appears once, at its better rank.
 */
export function matchCommands(
  commands: readonly AgentCommand[],
  query: string
): readonly AgentCommand[] {
  return commands
    .map((command) => ({ command, rank: rank(command, query) }))
    .filter((scored): scored is { command: AgentCommand; rank: number } => scored.rank !== null)
    .sort((left, right) => left.rank - right.rank)
    .map((scored) => scored.command)
}

/**
 * The draft after a command has been picked.
 *
 * A trailing space when the command takes arguments, and none when it does
 * not: the space is where the user types next, and adding one to a command
 * that takes nothing would leave them deleting it before they could send.
 */
export function completeCommand(command: AgentCommand): string {
  return command.argumentHint === '' ? `/${command.name}` : `/${command.name} `
}
