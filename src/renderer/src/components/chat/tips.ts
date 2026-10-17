import type { ChatEntry } from '@core/transcript.js'

/** Every heads-up there is; its strings live under `tips.<id>` in the locales. */
export type TipId = 'rewindSkipsCommands'

interface Tip {
  readonly id: TipId
  /** Whether the conversation has reached the point where this is worth saying. */
  readonly applies: (entries: readonly ChatEntry[]) => boolean
}

/**
 * The heads-ups, in the order they are offered.
 *
 * Each waits for the moment it becomes true of this conversation rather than
 * being shown on arrival: a caveat about commands means something once the
 * agent has run one, and is noise above an empty chat.
 */
export const TIPS: readonly Tip[] = [
  {
    id: 'rewindSkipsCommands',
    // A subagent's command counts too: it changes files past the checkpoints
    // just as the agent's own does.
    applies: (entries) =>
      entries.some(
        (entry) =>
          entry.role === 'agent' && entry.event.type === 'tool_use' && entry.event.name === 'Bash'
      )
  }
]

/**
 * The one heads-up to show now, or null.
 *
 * One at a time: a stack of caveats above the field is read as none of them.
 */
export function currentTip(
  entries: readonly ChatEntry[],
  hidden: ReadonlySet<string>
): TipId | null {
  return TIPS.find((tip) => !hidden.has(tip.id) && tip.applies(entries))?.id ?? null
}
