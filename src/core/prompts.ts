/**
 * Saved prompts: text the user inserts into a message or into a correction to
 * a plan, kept in a file of its own per store.
 *
 * Not the library's commands, and the difference is the whole reason for this
 * module: a command is expanded by the CLI where the user cannot see it, and a
 * prompt lands in the field as text they can still change. So there is no
 * session in the way, and nothing here is handed to one.
 *
 * Every write reads the file, changes the list and writes it back, which is
 * only safe one at a time. The line that makes it so is the service's — this
 * module knows one file and nothing about who else is writing it.
 */

import { randomUUID } from 'node:crypto'

import { CodedError } from './codedError.js'
import { readJsonFile, writeJsonFile } from './persist.js'
import { type Prompt, type PromptDraft, type PromptFile, PromptFileSchema } from './promptSchema.js'

export type PromptErrorCode = 'promptMissing'

/** A prompt the window named is not in the file any more. */
export class PromptError extends CodedError<PromptErrorCode> {
  override readonly name = 'PromptError'
}

const EMPTY: PromptFile = { version: 1, prompts: [] }

async function load(file: string): Promise<Prompt[]> {
  // A file that is there but wrong throws instead of reading as empty: the
  // next write would replace it, and a list ordered by hand is not something to
  // lose quietly (§13).
  return (await readJsonFile(file, PromptFileSchema, EMPTY)).prompts
}

function save(file: string, prompts: readonly Prompt[]): Promise<void> {
  return writeJsonFile(file, PromptFileSchema, { version: 1, prompts: [...prompts] })
}

function indexOf(prompts: readonly Prompt[], id: string): number {
  const index = prompts.findIndex((prompt) => prompt.id === id)

  if (index === -1) {
    throw new PromptError('promptMissing', { id }, `${id} is not here.`)
  }

  return index
}

/** Everything one store holds, in the order the user gave it. */
export function readPrompts(file: string): Promise<Prompt[]> {
  return load(file)
}

/** Adds one at the end. The id is made here, which is why it is a parameter. */
export async function createPrompt(
  file: string,
  draft: PromptDraft,
  newId: () => string = randomUUID
): Promise<Prompt> {
  const created: Prompt = { id: newId(), ...draft }
  await save(file, [...(await load(file)), created])

  return created
}

/** Changes what a prompt says, not where it stands or what it is called by. */
export async function updatePrompt(file: string, id: string, draft: PromptDraft): Promise<Prompt> {
  const prompts = await load(file)
  const index = indexOf(prompts, id)
  const updated: Prompt = { id, ...draft }

  await save(
    file,
    prompts.map((prompt, at) => (at === index ? updated : prompt))
  )

  return updated
}

export async function removePrompt(file: string, id: string): Promise<void> {
  const prompts = await load(file)
  indexOf(prompts, id)

  await save(
    file,
    prompts.filter((prompt) => prompt.id !== id)
  )
}

/**
 * Puts the prompts in the order `orderedIds` gives, as `reorderProjects` does
 * for the tab strip: a drop hands over the whole new order, not a move.
 *
 * Applied to what is on disk now, so a list the window drew before a prompt was
 * added or removed is still safe — ids that are gone are ignored, and a prompt
 * the list never heard of goes last, in the order it already had.
 */
export async function reorderPrompts(file: string, orderedIds: readonly string[]): Promise<void> {
  const rank = (prompt: Prompt): number => {
    const index = orderedIds.indexOf(prompt.id)
    return index === -1 ? orderedIds.length : index
  }

  await save(
    file,
    (await load(file)).toSorted((a, b) => rank(a) - rank(b))
  )
}
