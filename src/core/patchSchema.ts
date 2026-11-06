import { z } from 'zod'

type WithoutDefault<Field> = Field extends z.ZodDefault<infer Inner> ? Inner : Field

type WithoutDefaults<Shape extends z.ZodRawShape> = {
  [Key in keyof Shape]: WithoutDefault<Shape[Key]>
}

// `.partial()` keeps each ZodDefault, and it fires for an absent key, resetting the field.
// Only a top-level default is removed: one inside a pipe (`.default().transform()`) still
// fires, so re-declare that field plainly, as `ConfigPatchSchema` does.
export function withoutDefaults<Shape extends z.ZodRawShape>(shape: Shape): WithoutDefaults<Shape> {
  const entries = Object.entries(shape).map(
    ([key, field]) => [key, field instanceof z.ZodDefault ? field.unwrap() : field] as const
  )

  return Object.fromEntries(entries) as WithoutDefaults<Shape>
}
