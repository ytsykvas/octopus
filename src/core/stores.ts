/**
 * The two places octopus keeps things for the agent to find.
 *
 * A store is a directory handed to a session as an extra working-directory
 * root, so whatever Claude Code discovers under a root it discovers under one
 * of these: skills, and now the commands and subagents beside them. There are
 * exactly two — the installation's own and one per project — and nothing here
 * is written inside a checkout.
 *
 * A shape rather than a bare "global or project", because "the project's" is
 * not a place until it says which project — and the id crosses IPC, so it is
 * parsed rather than trusted.
 *
 * Pure — zod and nothing else behind it — because the window names a store on
 * every call it makes about one, and a value reached out of a module that pulls
 * in `node:os` has broken the renderer at runtime twice while every check
 * stayed green (§11.1, and the rule in `CLAUDE.md`).
 */

import { z } from 'zod'

export const StoreSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }),
  z.object({ kind: z.literal('project'), projectId: z.string().min(1) })
])
export type Store = z.infer<typeof StoreSchema>
