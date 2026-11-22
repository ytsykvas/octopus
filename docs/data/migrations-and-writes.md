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
  one a file replaced keeps its mode (setuid and the like dropped, as an editor
  drops them), and a new one gets `0o666` less the umask, as `writeFile` would.
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

**Every file core replaces goes through `persist.ts`**, not only the two stores:
the project's scripts and carry list, the instructions, skills and library
entries, and what an export writes into a repository's `.octopus/`. A script
matters most — `sh` reads it as it runs, so one rewritten in place goes on with
the new file's bytes from wherever it had got to, while a replaced one keeps
the inode it opened. `writeScript` and the repository's `script.*` pass
`0o755`, so the executable bit comes through the replacement. A replacement is a
new file: a symlink at the path — an instruction kept in dotfiles, say — becomes
a plain file and a hard link is cut; the mode the old file had is kept.

A file written once under a fresh name — a pasted image — has nothing to make
atomic, because nobody knows the name before the write returns. It goes through
`writeNewFile`, which creates it with `wx`, so two names colliding fail rather
than one picture silently replacing another.

The rule holds by lint, not by memory: `no-restricted-imports` in
`eslint.config.js` refuses `writeFile` from `fs/promises`, and `writeFile`,
`writeFileSync` and `promises` from `fs`, anywhere in `src/core/` and
`src/main/` except `persist.ts` itself, `diagnostics.ts` (below) and the tests,
which build their fixtures with them.

Two writers append rather than replace, and stay outside it on purpose: a
transcript gains one line per entry (`appendFile` in `transcript.ts`), and the
diagnostics log one line per swallowed error (`diagnostics.ts`, synchronous
because it runs inside `catch`). An append never shows a reader half of the
old file. When the diagnostics log outgrows what it keeps, it is cut by writing
`main.log.tmp` and renaming it over the log — synchronously, since it runs
inside `catch`, which is why it does this itself rather than through
`persist.ts`.

Reading validates with zod and **fails loudly** on a corrupt file rather than
falling back to defaults. Silently resetting someone's projects because a byte
went wrong is worse than refusing to start.

## The state's backup

`saveState` keeps the version each save replaces as `state.json.bak`, beside
the file. The step sits inside `replaceThrough`, after the new contents are
synced and before the rename (`keepBackup` in `persist.ts`): `state.json` is
**hard-linked** as `state.json.bak.tmp` — cleared first, so a crash leaves
nothing to pile up — which is then renamed over the old
`.bak` — so the previous backup goes only as the new one takes its place, and a
failure in between leaves it as it was. A link copies nothing, so it
costs the same whatever the file's size, and once the rename puts a new inode at
`state.json` the old one — synced when it was written — lives on under `.bak`.
A filesystem without hard links (`EPERM`, `ENOTSUP`) gets a copy instead. A
first run has nothing to link and writes no backup. A backup that cannot be
kept goes to the diagnostics log and the save goes on (`onBackupFailed`): the
older backup stays, and losing every save would be worse than one backup behind.

Both companions follow the state's own path — `<state>.tmp` for the write and
`<state>.bak`, the one rule `backupFileOf` in `paths.ts` holds, for the backup —
with no option to put either elsewhere, so a test or a copy that points the
state elsewhere never writes into the real root, and the hard link never crosses
a filesystem. Saves are serialised (`commit`), so two
never race for the `.bak`, and the data-root lock covers it with the rest.
`config.json` and the transcripts get no backup.

The backup is offered, never taken silently. When the service fails to start
because `state.json` itself does not read (`InvalidFileError` on that path) and
`.bak` parses as a state, `main` asks before any window exists: Restore or Quit,
with when the copy was saved and how many projects it holds. Restore copies the
damaged file aside as `state.json.broken-<time>`, writes the backup over
`state.json` atomically and starts again; a second failure ends in the same
error box as before, and a restore that fails names both failures. Quit quits —
no second box saying the app could not start, since the user just chose that.
Without a good backup the start fails with the original error. The damaged file
is **copied** aside rather than renamed: until the backup has landed
`state.json` stays where it is, because a moment with no file at all is a moment
in which a start reads "first run" — the silent reset this whole section
refuses. The decisions are in `openWithRecovery` (`stateRecovery.ts`), which
answers `null` for a Quit; `main/index.ts` only shows the question.
