# A carried file can land outside the worktree

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`carriedFiles` confines a destination **textually** — not absolute, and
`normalize(path)` must not start with `..` — and `carryInto` then trusts that
outright. Its comment says "Every destination here is relative and cannot climb
out … so nothing below has to check again", and it goes on to
`join(workspacePath, path)`, `mkdir(dirname(to), { recursive: true })` and
`copyFile(from, to, COPYFILE_EXCL)`. Both follow symbolic links in the
intermediate segments.

A worktree that contains a tracked symlink — `config -> ../shared/config` — makes
`config/master.key` a path that passes the textual check and resolves outside the
worktree. Reproduced at the fs level, and reproduced with real git that a
worktree materialises such a symlink verbatim, so the shape exists at exactly the
moment `carryInto` runs.

`COPYFILE_EXCL` still applies at the resolved target, so nothing is overwritten.
The failure is a silent misplacement plus a boundary escape, not data loss.

Nowhere in `carry.ts` is `lstat` called. `repoConfig.ts` has exactly this check —
`assertUnlinkedPath` — and its comment records that checking only the final
component shipped broken once for the same reason.

## Why it matters

The non-adversarial case is the common one: a monorepo or dotfiles-style checkout
that tracks a symlinked directory and carries `config/master.key`. The file is
written through the link, `carryInto` returns the path **as written**, `prepare`
hands that up to the UI as carried, `git status` in the worktree shows nothing,
and the workspace boots as though the file were missing. The app reports success
for a write that landed somewhere the user never named.

What travels is credentials, and it runs at workspace creation, before any script
has been approved.

Three written claims are false in the presence of a symlinked segment:
`SECURITY.md:45-51` names the three roots the app may touch;
`docs/data.md:544-547` says the left half of a carry line "stays inside the
worktree"; `carry.ts:89` says "checked to stay inside it".

## Evidence

- `src/core/carry.ts:131-138` — the whole of the destination check, textual only.
- `src/core/carry.ts:203-204` — the comment licensing the skipped second check;
  `:208-219` — join, mkdir, copyFile, and a catch that swallows every failure.
- `src/core/service.ts:2685-2705` — `createWorkspaceIn`: worktree add, then
  `prepare`, before any script approval.
- `src/core/repoConfig.ts:311-320` — `assertUnlinkedPath`, the correct treatment.
- `src/core/workspaces.ts:620-648` — `fileInWorkspace`, "Lexical containment is
  not containment", `realpath` on both sides. The only site doing it properly.
- `src/core/carry.test.ts:70-74` — the only containment test, textual cases only.
  Neither it nor `env.test.ts` creates a symlink; seven other test files do, and
  `repoConfig.test.ts:229-240` is the shape to copy.

## What is already decided

**"No gate at all" would be wrong to say.** A repository's `.octopus/carry` is
never read at runtime (`repoConfig.ts:11-20`, `docs/data.md:552-555`) — reaching
the list from a repository takes a deliberate import that shows the user every
byte. The honest statement is "no symlink check on the destination".

**The fix must not throw.** `carriedFiles` drops a bad line silently and
deliberately, and `carryInto`'s catch treats failure as ordinary. More to the
point, `createWorkspaceIn` runs `prepare` inside a rollback — an exception there
deletes the whole worktree. A symlinked destination should skip that one line.

**`carriedFiles` is the wrong home for the check.** It is synchronous and pure,
and `service.ts:2370` calls it to answer `projectInstructionSources`, with no
worktree path in hand at all. The check belongs inside `carryInto`'s loop.

## Sketch

Order matters and `assertUnlinkedPath` cannot be reused verbatim.
`mkdir(dirname(to), { recursive: true })` creates the intermediate directories
itself, so a check after it cannot distinguish a directory git checked out from
one this call just made — and it must still run before `copyFile`. Walking the
segments lexically with `lstat` (the `repoConfig.ts:311` shape) works before the
mkdir; that function throws a `RepoConfigError`, so carry wants the predicate,
not the function. Alternatively `realpath(dirname(to))` after the mkdir compared
via `relative()` against `realpath(workspacePath)` — the `fileInWorkspace` shape,
which also catches a worktree whose own path runs through a link (`/var` on
macOS).

**A second place has the same hole, on the same code path, and it is worse.**
`envFile` is confined by the identical textual rule at `store.ts:467`, and
`env.ts` then writes `join(workspacePath, envFile)` with no link check at
`removeEnvBlock` (`:77`), `discardIfOnlyBlock` (`:113`) and `applyEnvOverrides`
(`:145`). `prepare` calls the last two on **every run**, not just creation. Two
of those branches call `rm(path, { force: true })` when the file is left holding
nothing, so a symlinked segment turns a delete loose outside the worktree. It
only removes a file whose entire content is our own block, which narrows it — but
fix both or the boundary is still open.

`docs/tasks/three-modules-spell-the-same-path-rule.md` has stale line numbers
(`carry.ts:73`/`carriedPaths` is now `carry.ts:137`/`carriedFiles`; `store.ts:327`
is now `store.ts:467`). It asserts "Each is correct today"; add the symlink
dimension to it and name the fourth site, `fileInWorkspace`.
