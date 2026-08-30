# The env block has no safe form of the workspace name

## What happens

`$OCTOPUS_WORKSPACE_NAME` substitutes `workspace.name` — the label as typed.
Renaming only trims it (`workspaces.ts:252`), so it may hold spaces, capitals
and punctuation; the branch is slugified through `branchFor`, the name is not.

That is fine for a script, which can slugify what it is given. It is not fine
for the env block, which is static text with no shell around it. The obvious
use — giving each workspace its own database —

    MYAPP_DEV_DB_NAME=myapp_development_$OCTOPUS_WORKSPACE_NAME

writes `myapp_development_Fix login bug` into `.env` the moment somebody renames
a workspace to a sentence. `dotenv` reads the value up to the first space, so
what the framework connects to is `myapp_development_Fix`, and nothing says so.

## Why it matters

Per-workspace databases are the main thing an env override exists for, and the
`.conductor` setup octopus was measured against does exactly this — the
difference being that Conductor's version lives in a shell script that
lowercases, replaces every non-alphanumeric with `_` and truncates to 30 chars
so the full name stays inside Postgres' 63-char identifier limit.

Default names (`ada`, `alice`) are already safe, so this stays invisible until
the first rename — at which point a workspace quietly shares, or fails to find,
a database.

## Evidence

- `src/core/scriptEnv.ts:33` — `WORKSPACE_VARIABLE`; no slugified companion
- `src/core/service.ts:1551` — `workspaceName: workspace.name`, the raw label
- `src/core/workspaces.ts:252` — rename trims and nothing more
- `src/core/git.ts:239` — `toSlug` exists, but produces a git ref, not an
  identifier: it keeps `-` and `.`, both of which need quoting in SQL

## What is already decided

Only `OCTOPUS_*` names are substituted, and an unknown one is left alone
(`envBlock.ts:51`) — so a new name is additive and cannot corrupt a password.
The block warns rather than refuses (§12.2), so a mistyped variable is already
reported as `unknownVariable`.

## Sketch

A second variable — `$OCTOPUS_WORKSPACE_SLUG` — lowercased, every
non-alphanumeric to `_`, truncated so a prefix still fits in 63 characters.
Given to scripts as well, since a script that wants the same identifier is
currently writing that `sed` pipeline by hand.
