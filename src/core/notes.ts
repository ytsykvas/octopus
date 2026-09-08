/**
 * What a workspace's note may hold.
 *
 * Its own module, and pure — zod and nothing else behind it — because the
 * **window** enforces the ceiling as the text is typed, and a value reached out
 * of a module that pulls in `node:os` has broken the renderer at runtime twice
 * while every check stayed green (§11.1, and the rule in `CLAUDE.md`).
 */

import { z } from 'zod'

/**
 * The ceiling, in characters.
 *
 * Bounded for a reason that is not about the note: `commit` rewrites
 * `state.json` **whole** on every call, so a note with no limit would be paid
 * for by every unrelated write of every other field in the file.
 *
 * Enforced in two places on purpose, and they are not the same guard. The field
 * refuses the character, so nobody types into something that will not be kept;
 * the parse at the bridge refuses the message, because types are gone by then
 * and a window sending more is exactly what a boundary is for.
 */
export const NOTES_LIMIT = 16_000

export const NotesBodySchema = z.string().max(NOTES_LIMIT)
