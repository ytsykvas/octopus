/**
 * What a command or a subagent is called, and which of the two it is.
 *
 * Pure — zod and nothing else behind it — because the import dialog validates a
 * name as it is typed, and a constant reached out of a module that pulls in
 * `node:os` has broken the renderer at runtime twice while every check stayed
 * green (§11.1, and the rule in `CLAUDE.md`).
 */

import { z } from 'zod'

/**
 * The two things a store holds beside its skills.
 *
 * A **command** is what the user types after a slash; the file's name is the
 * command's, and its body is the prompt. A **subagent** is a helper the model
 * reaches for on its own; its frontmatter names it, says when to use it, and
 * may narrow the tools it gets.
 *
 * Both are one markdown file — which is the whole difference from a skill, and
 * the reason they share a module rather than reusing that one: a skill is a
 * directory that may carry scripts and references beside its `SKILL.md`.
 */
export const LibraryKindSchema = z.enum(['command', 'subagent'])
export type LibraryKind = z.infer<typeof LibraryKindSchema>

/**
 * A name, which is also the file it lives in.
 *
 * The pattern is doing security work, not tidiness: this string is joined onto
 * a path and handed to a delete, so `.`, `..`, a separator and a leading dash
 * all have to be impossible rather than checked for later.
 *
 * Underscores are allowed where a skill's name refuses them, because a command
 * is typed by the user and `/run_checks` is a name people write. The two rules
 * are separate for that reason rather than by accident.
 */
export const LibraryNameSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/)

/** Whether a string may name one, for a field that reports as it is typed. */
export function isLibraryName(value: string): boolean {
  return LibraryNameSchema.safeParse(value).success
}
