/**
 * What a skill is called, and how the agent is told which one we mean.
 *
 * Pure — zod and nothing else behind it — because the window validates a name
 * as it is typed, and a constant reached out of a module that pulls in
 * `node:os` has broken the renderer at runtime twice while every check stayed
 * green (§11.1, and the rule in `CLAUDE.md`).
 */

import { z } from 'zod'

/**
 * Where a skill came from.
 *
 * The first two are ours and can be written to. `repository` is what the
 * checkout carries in its own `.claude/skills`: the agent loads it without us,
 * we can switch it off for a conversation, and we never edit it.
 *
 * `session` is everything else the agent holds and octopus never looked for —
 * Claude Code's own bundled skills, the user's `~/.claude/skills`, a plugin's.
 * They have no directory here, which is what makes them a scope of their own
 * rather than a fourth place to read: the session is asked, and the answer is
 * whatever it did not come from us.
 */
export const SkillScopeSchema = z.enum(['global', 'project', 'repository', 'session'])
export type SkillScope = z.infer<typeof SkillScopeSchema>

/**
 * A skill's name, which is also the directory it lives in.
 *
 * The pattern is doing security work, not tidiness: this string is joined onto
 * a path and handed to a recursive delete, so `.`, `..`, a separator and a
 * leading dash all have to be impossible rather than checked for later.
 */
export const SkillNameSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

/** Whether a string may name a skill, for a field that reports as it is typed. */
export function isSkillName(value: string): boolean {
  return SkillNameSchema.safeParse(value).success
}

/**
 * The name the agent knows a skill by, which is also the key every stored
 * answer uses.
 *
 * The bare name, whichever of the three sources it came from — and that is a
 * fact about the agent rather than a simplification of ours. Every source
 * reaches a session the same way, so two skills sharing a name are one skill
 * as far as the CLI is concerned: measured against a live session, a
 * `local-probe` in the checkout and a `local-probe` in our own store came back
 * as a single row. A key that distinguished them would be describing something
 * the agent cannot tell apart.
 *
 * A function rather than the name itself so there is one place saying so, and
 * one place to change if a source ever qualifies its skills again.
 */
export function skillKey(name: string): string {
  return name
}
