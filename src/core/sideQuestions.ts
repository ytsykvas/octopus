/**
 * Side questions: `/btw`, answered beside a conversation rather than in it.
 *
 * Nothing but zod behind this module, so the window can import its values —
 * it decides what a typed message means before anything crosses the bridge.
 */
import { z } from 'zod'

export const SideExchangeSchema = z.object({
  question: z.string(),
  response: z.string()
})
export type SideExchange = z.infer<typeof SideExchangeSchema>

/** The CLI's own cap: each exchange is replayed into the fork, so more makes every question dearer. */
export const SIDE_HISTORY_LIMIT = 20

const SIDE_QUESTION_MAX_LENGTH = 20_000

export const SideQuestionSchema = z.string().trim().min(1).max(SIDE_QUESTION_MAX_LENGTH)

export const SideHistorySchema = z.array(SideExchangeSchema).max(SIDE_HISTORY_LIMIT)

export interface SideAnswer {
  readonly text: string
  /** Written by the CLI ("no answer available"), not the model; drawn quieter. */
  readonly synthetic: boolean
}

/**
 * Whether a message is `/btw`, and the question it carries.
 *
 * Matched by the literal name rather than the command list: the window routes
 * it before deciding whether to send at all. Bare `/btw` matches with an empty
 * question.
 */
export function parseBtw(text: string): { question: string } | null {
  const match = /^\s*\/btw(?:\s+([\s\S]*))?$/i.exec(text)
  if (match === null) return null

  return { question: (match[1] ?? '').trim() }
}

/**
 * A message for a conversation forked off a side answer, with that exchange in
 * front of it.
 *
 * The CLI writes the exchange into the forked session file as a turn of its
 * own. That file's format is the CLI's and undocumented, so the fork carries
 * the exchange on its record instead and hands it over with the first message
 * — the agent learns it one message later, and nothing here breaks when the
 * format moves.
 */
export function formatAside(aside: SideExchange, text: string): string {
  return [
    'Before this message, I asked you a side question about this conversation, and you answered it without tools. That exchange is part of the conversation now.',
    `## My side question\n\n${aside.question}`,
    `## Your answer\n\n${aside.response}`,
    `## My message\n\n${text}`
  ].join('\n\n')
}
