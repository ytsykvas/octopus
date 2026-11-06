/**
 * Patches built from the schema of what they patch.
 *
 * Built from the record's own schema, a patch cannot drift from it — but it
 * must not inherit the record's defaults, which exist so old files load.
 */

import { z } from 'zod'

/** A field's schema with its default taken off, and anything else untouched. */
export type WithoutDefault<Field> = Field extends z.ZodDefault<infer Inner> ? Inner : Field

export type WithoutDefaults<Shape extends z.ZodRawShape> = {
  [Key in keyof Shape]: WithoutDefault<Shape[Key]>
}

/**
 * Takes the defaults off a shape, so a patch built from it stays a patch.
 *
 * `.partial()` wraps each field in `ZodOptional` and leaves any `ZodDefault`
 * sitting inside — and a default still fires for a key that is absent. So
 * parsing a patch of one field returned every defaulted field as well, and
 * `updateProject` applies whatever is not `undefined`: choosing a colour reset
 * the env profile, both approval lists and the trust flag, and moved the env
 * file back to `.env`, which then stripped the block out of every worktree.
 *
 * The defaults belong where they are: a record's schema has to read files
 * written before those fields existed. It is the patch that must not inherit
 * them.
 *
 * Only a default at the top of a field is reached. One inside a pipe — a
 * `.default()` followed by `.transform()` — still fires, so a patch names that
 * field's plain schema itself, as `ConfigPatchSchema` does for two.
 *
 * Mapped rather than listed by hand: a seventh defaulted field would be added to
 * `ProjectSchema` and to nothing else, and the `CHANGES` record in the tests
 * guards presence in the spread rather than absence of a default.
 */
export function withoutDefaults<Shape extends z.ZodRawShape>(shape: Shape): WithoutDefaults<Shape> {
  const entries = Object.entries(shape).map(
    ([key, field]) => [key, field instanceof z.ZodDefault ? field.unwrap() : field] as const
  )

  return Object.fromEntries(entries) as WithoutDefaults<Shape>
}
