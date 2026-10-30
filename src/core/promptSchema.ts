/**
 * What a saved prompt is, and how long its parts may be.
 *
 * Pure — zod and nothing else behind it — because the editor sets its fields'
 * limits from here and the fan lays out a pill from `firstLine`, and a value
 * reached out of a module that pulls in `node:os` has broken the renderer at
 * runtime twice while every check stayed green (§11.1, and the rule in
 * `CLAUDE.md`).
 */

import { z } from 'zod'

/** A title sits on a pill in the fan, so its limit is one of layout, not storage. */
export const PROMPT_TITLE_MAX = 40
export const PROMPT_TEXT_MAX = 20_000

export const PromptIdSchema = z.uuid()

/** What the editor hands over: everything but the id, which is core's to make. */
export const PromptDraftSchema = z.object({
  title: z.string().trim().min(1).max(PROMPT_TITLE_MAX),
  text: z.string().trim().min(1).max(PROMPT_TEXT_MAX),
  forPlan: z.boolean().default(false)
})
export type PromptDraft = z.infer<typeof PromptDraftSchema>

export const PromptSchema = PromptDraftSchema.extend({ id: PromptIdSchema })
export type Prompt = z.infer<typeof PromptSchema>

/** One store's file. The `prompts` default is what lets a hand-made `{version:1}` load. */
export const PromptFileSchema = z.object({
  version: z.literal(1),
  prompts: z.array(PromptSchema).default([])
})
export type PromptFile = z.infer<typeof PromptFileSchema>

/** What the settings list shows under a title: the first line with words in it. */
export function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  )
}
