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

Both writers share one helper, `replaceThrough`, and it holds three things:

- **The temporary file is created exclusively** — `open` with `wx`, which is
  `O_CREAT | O_EXCL`. That never follows a symbolic link and fails with
  `EEXIST` on a path that already exists, so the bytes can only reach a file
  this write made. A failed write removes its temporary file, and only that:
  when `open` itself fails, the path belongs to somebody else and stays. The
  removal is settled rather than awaited bare, so a cleanup that fails never
  replaces the error being reported.
- **A mode asked for is set on the descriptor** (`fchmod`), not the path, so
  umask bits cannot clear it and a swapped-in link cannot receive it. Without
  one the file is created as `writeFile` would (`0o666` less the umask); the
  target's previous mode is not kept.
- **The contents are `fsync`ed before the rename**, so after a power cut the
  new name does not point at an empty `state.json`. On macOS `fsync(2)` without
  `F_FULLFSYNC` leaves the drive free to cache and reorder the write, and the
  directory is not synced after the rename — both accepted.

The temporary name differs by writer. `writeTextFile` uses
`<target>.<random>.tmp`: it writes into git worktrees, where a repository can
commit a link at any fixed name. A crash between create and rename leaves its
own `<target>.<random>.tmp` that no later write reuses or removes — in a
worktree, where `.env*` ignore patterns cover it, and beside a transcript under
the data root. `writeJsonFile` keeps the fixed `<target>.tmp`, because its
callers serialise writes on that path; it lives in the data root, and whatever
a crash left there is removed with `rm` — which takes a link, never its target
— before the exclusive create.

Reading validates with zod and **fails loudly** on a corrupt file rather than
falling back to defaults. Silently resetting someone's projects because a byte
went wrong is worse than refusing to start.
