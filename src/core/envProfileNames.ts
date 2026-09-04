/**
 * What a set of variables may be called.
 *
 * Pure — zod and nothing else behind it — because the window validates a name
 * as it is typed, and a constant reached out of a module that pulls in
 * `node:fs` has broken the renderer at runtime twice while every check stayed
 * green (§11.1, and the rule in `CLAUDE.md`). `skillNames.ts` exists for the
 * same reason and answers the same question about skills.
 *
 * Split out of `envProfiles.ts` when the dialog asking for a name was built:
 * that module reads and writes files, so the rule it enforces was unreachable
 * from the one place that most needs it — the field somebody is typing into.
 */

import { z } from 'zod'

/**
 * The name a project's first set of variables is given.
 *
 * Chosen so `ProjectSchema.envProfile` can default to it: a project record
 * written before profiles existed then reads back pointing at exactly the file
 * the migration created, and no record needs migrating at all.
 */
export const DEFAULT_PROFILE = 'default'

/**
 * What a profile may be called.
 *
 * It becomes a filename, so this is a boundary rather than a label. Lowercase
 * is part of it because macOS filesystems are case-insensitive by default:
 * `Prod` and `prod` would be one file under two names in `state.json`, and
 * whichever the app wrote last would be what both resolved to.
 */
export const ProfileNameSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9-]*$/u)

/**
 * Whether a string may name a profile, for a field that reports as it is typed.
 *
 * The same shape as `isSkillName`: a predicate rather than the schema, so the
 * caller asks a question instead of reading a `safeParse` result — and so the
 * one rule is applied before the round trip as well as at the boundary.
 */
export function isProfileName(value: string): boolean {
  return ProfileNameSchema.safeParse(value).success
}
