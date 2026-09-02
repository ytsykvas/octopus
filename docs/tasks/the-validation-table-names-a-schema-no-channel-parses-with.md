# The validation table names a schema no channel parses with

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`docs/ipc.md` opens its Validation section with "Every argument that becomes a
path, a process argument or a file is parsed with zod before it goes anywhere",
then runs straight into an eight-row table of argument-to-schema pairs with no
"for example" hedge — so the table reads as the boundary contract.

The row `permission mode | PermissionModeSchema` guards nothing.
`PermissionModeSchema` occurs in exactly two places in the whole `src/` tree: its
declaration at `chats.ts:96` and the `z.infer` on the next line. **`.parse` is
never called on it anywhere in the repository.** The channel the row is about,
`chats:mode`, parses with `WorkingModeSchema` at `ipc.ts:610` — a schema the
table never names.

Git shows the drift precisely: `5507742` added `PermissionModeSchema` to both
`src/main/ipc.ts` and `docs/ipc.md` in one commit, so the row was correct when
written; `a5c250b` — the split `docs/data.md:232` describes — removed it from
`ipc.ts`, added `WorkingModeSchema`, touched `docs/ipc.md`, and left the row. The
docs now carry the only surviving trace of the pre-split spelling.

Of the eight rows, six are wholly boundary-accurate. The other stale one,
`account kind | AccountKindSchema`, names the right schema but not the right
layer: `ipc.ts:182` passes `kind` through on a bare TypeScript annotation and
`cliFor` (`accounts.ts:225`) does the `safeParse`. The value **is** rejected and
the deeper parse is asserted by tests, so that one is doc placement against
`docs/architecture.md:136` ("Validation happens in `main/ipc.ts`, not deeper"),
not an unvalidated argument.

## Why it matters

This table is what someone reviewing the security boundary reads to answer "is
every argument from the renderer validated". It sends them to check a schema that
is not on the boundary, and `chats:mode` — the model to copy when adding a
channel — is absent.

The `PermissionModeSchema` row reads as current API rather than as history.

## Evidence

- `docs/ipc.md:212-216` and `:217` — the bold rule running into the header with
  no hedge; `:225` — the row.
- `src/core/chats.ts:96-97` — the only two occurrences; `:111-113` —
  `WORKING_MODES … satisfies readonly PermissionMode[]`.
- `src/main/ipc.ts:28` and `:610` — `WorkingModeSchema.parse(mode)`.
- `git 5507742` and `git a5c250b`; `docs/data.md:232-236`.
- `src/main/ipc.ts:182`; `src/core/accounts.ts:224-229`;
  `accounts.test.ts:177-182`, `:225`.
- `src/main/ipc.ts:140`, `:556` (`FilePathSchema`) and `:43`, `:497-499`
  (`RevertPathSchema`) — both absent from the table.

## What is already decided

**Do not delete `PermissionModeSchema` from `chats.ts`.** It looks dead and is
load-bearing twice: it is the source of the `PermissionMode` type, and that type
is what the `satisfies readonly PermissionMode[]` at `chats.ts:111` checks
against. Its own doc comment explains why — `satisfies` ties the list to the
SDK's union so a value renamed there is a compile error rather than a mode the
session never enters. The defect is in the docs only.

**The path omission is weaker than it looks.** The table does omit
`FilePathSchema` and `RevertPathSchema`, but the guarantee is already documented:
`docs/ipc.md:112` says of `workspaces:revertFile` "Both paths are parsed here",
and `:125` says of `files:open` "the path is validated and proved inside the
worktree". What is missing from the table is the two schema _names_. That makes
this an inconsistency, not a security blind spot.

**Renaming the row to `WorkingModeSchema` is not sufficient.** The pair
`docs/data.md:232` says was split is `workingMode` _and_ `planMode`, and
`chats:planMode` (`ipc.ts:614`) parses with a bare inline
`z.boolean().parse(planning)` — no named schema for the table to cite.

## Sketch

The table's real problem is that it is an unmarked eight-row sample of 27 schemas
that reads as exhaustive. Either mark it as illustrative, or drop the
per-argument table and let the channel tables carry the notes they already carry
— that is also what stops the next split from leaving a stale row.

Do this in the same pass as
`four-places-count-nine-host-functions-and-there-are-ten.md`, which proposes
edits to `docs/ipc.md:256-258` and notes the "Adding a channel" checklist has no
step for a push stream. Same file, same pass.
