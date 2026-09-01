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
 * The two plugin names octopus's own skill stores answer to.
 *
 * A local plugin is how a directory of skills reaches a session, and a plugin
 * has a name the agent prefixes onto every skill inside it. These two are
 * fixed rather than derived from the project: only one project's store is ever
 * loaded into a session, so there is nothing to collide with, and a name built
 * from a project would change under a rename and orphan every key stored
 * against it.
 */
export const GLOBAL_PLUGIN = 'octopus'
export const PROJECT_PLUGIN = 'octopus-project'

/**
 * Where a skill came from.
 *
 * The first two are ours and can be written to. `repository` is what the
 * checkout carries in its own `.claude/skills`: the agent loads it without us,
 * we can switch it off for a conversation, and we never edit it.
 */
export const SkillScopeSchema = z.enum(['global', 'project', 'repository'])
export type SkillScope = z.infer<typeof SkillScopeSchema>

/**
 * Which of the two stores a settings section is editing.
 *
 * A shape rather than the bare scope, because "the project's" is not a place
 * until it says which project — and the id crosses IPC, so it is parsed rather
 * than trusted.
 */
export const SkillStoreSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }),
  z.object({ kind: z.literal('project'), projectId: z.string().min(1) })
])
export type SkillStore = z.infer<typeof SkillStoreSchema>

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
 * The name the agent knows a skill by.
 *
 * Ours are qualified by their plugin; the checkout's are bare, because nothing
 * qualifies them. The CLI looks an override up by the qualified name and falls
 * back to the bare one, so a bare key written for one of ours would silence a
 * repository skill of the same name as well — hence always the qualified form.
 */
export function skillKey(scope: SkillScope, name: string): string {
  if (scope === 'global') return `${GLOBAL_PLUGIN}:${name}`
  if (scope === 'project') return `${PROJECT_PLUGIN}:${name}`

  return name
}
