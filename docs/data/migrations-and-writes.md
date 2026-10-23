# Migrations and atomic writes

## Migrations

`migrate` in `store.ts` runs on every load. It has done two things so far:

- **qualified bare workspace ids** with their project, from before ids carried
  one;
- **handed colours to projects that predate them.** A schema `.default()` was
  wrong here: it would have given every existing project the same colour, which
  is the opposite of what a colour is for. So `color` is optional in the schema
  and filled in during migration, each pick seeing what the previous ones took.

The distinction is worth remembering: a default is right for a field with one
sensible value, and wrong for one whose whole purpose is to differ.

`icon` is the other side of it and got **no** migration: a project nobody has
picked a picture for falls back to its initials, so "absent" is already the right
answer and handing out icons the way colours were handed out would be inventing
choices for people. The field is optional on disk and nullable in a patch —
`null` is how the dialog says "back to the initials", which is a value rather
than an absence, and telling the two apart is what makes the choice reversible.

## Atomic writes

`persist.ts` writes to a temporary file and renames it. A rename is atomic on
the same filesystem, so a crash mid-write leaves either the old file or the new
one — never half of either.

Reading validates with zod and **fails loudly** on a corrupt file rather than
falling back to defaults. Silently resetting someone's projects because a byte
went wrong is worse than refusing to start.
