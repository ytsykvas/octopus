/**
 * The agent's own questions to the user.
 *
 * `AskUserQuestion` is an ordinary tool: the agent calls it with a set of
 * questions and ready-made options, and the answer travels back the same way a
 * permission does — through `canUseTool`, as a modified copy of the tool's own
 * input. There is no separate channel for it, and the two SDK mechanisms that
 * look like one (`onUserDialog`, MCP elicitation) are different things.
 *
 * Which is why this module is in `core/` rather than beside `readPlan` in the
 * renderer: a plan is a string the window merely draws, but these questions the
 * core has to *understand* — it builds the answered input, and `config.ts`
 * needs the tool's name. It pulls in nothing but zod, so the renderer may
 * import from it as a value (§11.1).
 */

import { z } from 'zod'

/** The tool the agent calls to ask. */
export const ASK_USER_QUESTION = 'AskUserQuestion'

/**
 * What joins several chosen options into one answer.
 *
 * The CLI's own separator: it writes multi-select answers this way and splits
 * them back on exactly this string. Ours has to match or the agent reads one
 * answer where the user gave two.
 */
export const ANSWER_SEPARATOR = ', '

const QuestionOptionSchema = z.object({
  /** A few words, which is what the user actually picks. */
  label: z.string().min(1),
  /** What choosing it means. Absent on a terse question rather than never. */
  description: z.string().default(''),
  /**
   * A mock-up or snippet for comparing options, in markdown.
   *
   * Optional rather than defaulted: "no preview" and "an empty preview" would
   * draw differently, and the tool omits the field entirely when there is none.
   */
  preview: z.string().optional()
})

const QuestionSchema = z.object({
  question: z.string().min(1),
  /** A short chip above the question — twelve characters or so. */
  header: z.string().default(''),
  multiSelect: z.boolean().default(false),
  options: z.array(QuestionOptionSchema).min(1)
})

/**
 * The tool's input, as much of it as we read.
 *
 * `looseObject` on purpose, and load-bearing: the answer goes back as a copy of
 * this object, and the tool carries fields we have no business knowing about —
 * `metadata` for its own accounting among them. A strict schema would drop them
 * silently on the way through.
 *
 * Deliberately more permissive than the tool's own schema, which caps questions
 * at four and demands at least two options. A stricter parser would take the
 * whole card away on a fifth question — a worse failure than drawing five.
 */
const AskUserQuestionSchema = z.looseObject({
  questions: z.array(QuestionSchema).min(1)
})

export type UserQuestions = z.infer<typeof AskUserQuestionSchema>
export type UserQuestion = z.infer<typeof QuestionSchema>
export type QuestionOption = z.infer<typeof QuestionOptionSchema>

/**
 * The questions in a tool call, or null when it is not one of ours.
 *
 * Null rather than a throw for the same reason as `readPlan`: this runs while
 * drawing the log, over input the model wrote, and a malformed call has to fall
 * back to the ordinary permission card rather than take the conversation down.
 */
export function readQuestions(toolName: string, input: unknown): UserQuestions | null {
  if (toolName !== ASK_USER_QUESTION) return null

  const parsed = AskUserQuestionSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

/**
 * One question's answer, as the card collects it.
 *
 * Structured rather than the string the tool wants, because this is also what
 * gets written to the transcript: read back a month later, a card has to show
 * which options were ticked, and a joined string cannot be taken apart again
 * once a label contains the separator.
 */
export const QuestionAnswerSchema = z.object({
  /** The question this answers, by its full text — the tool keys on that. */
  question: z.string().min(1).max(2_000),
  /** Labels of the chosen options. Several only when `multiSelect`. */
  selected: z.array(z.string()).default([]),
  /**
   * What the user wrote instead of, or beside, the offered options.
   *
   * The tool's schema says an "other" choice is not among the options and the
   * host is to provide one. Bounded like `PlanFeedbackSchema`: it reaches the
   * agent as text, which makes it a prompt.
   */
  other: z.string().max(10_000).nullable().default(null)
})

export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>

/** Everything the user said about one question, as the tool wants to read it. */
function joinAnswer(answer: QuestionAnswer): string | null {
  const parts = [...answer.selected]

  const other = answer.other?.trim()
  if (other !== undefined && other !== '') parts.push(other)

  return parts.length === 0 ? null : parts.join(ANSWER_SEPARATOR)
}

/**
 * The tool's input with the user's answers written into it.
 *
 * This is how an answer reaches the agent at all: the tool reads `answers` off
 * its own input, so the reply to the permission request carries a modified copy
 * rather than a message of its own.
 *
 * Free text goes in here too, beside the chosen labels, rather than into the
 * separate `response` field the tool's *output* has. Measured against the CLI:
 * its branch for `response` discards the list answers entirely, so anything
 * ticked would vanish the moment something was also typed.
 *
 * A question nobody answered is left out rather than written as an empty
 * string, which the tool would read as an answer that says nothing.
 */
export function withAnswers(
  input: UserQuestions,
  answers: readonly QuestionAnswer[]
): UserQuestions {
  const collected: Record<string, string> = {}

  for (const answer of answers) {
    const joined = joinAnswer(answer)
    if (joined !== null) collected[answer.question] = joined
  }

  return { ...input, answers: collected }
}
