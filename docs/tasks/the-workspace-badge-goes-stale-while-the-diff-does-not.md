# The changed-file badge goes stale while the diff beside it updates

**Found:** 2026-08-14, while building the diff viewer.

## What happens

A workspace row carries the number of files it has changed. That number is read
when the workspace list is read — on create, rename, remove, and on the initial
load — and never again. The agent can rewrite twenty files and the badge still
says what it said an hour ago.

The diff pane now re-reads itself when a turn ends, so the two sit side by side
disagreeing: the pane lists eight files and the row beside it says three.

## Why it matters

Before the diff existed the badge was the only signal, and stale-but-plausible
was survivable. Next to a pane that is demonstrably current it reads as a bug,
because it is one.

## Evidence

- `src/core/workspaces.ts:383,396` — `changedFiles` comes from `reconcile`, which
  runs inside `listWorkspaces`.
- `src/renderer/src/hooks/useWorkspaces.ts:60` — `refresh` is called by
  `create`, `rename` and `remove`, and by `App` on a project change. No event
  triggers it.
- `src/renderer/src/hooks/useWorkspaceDiff.ts` — the diff subscribes to
  `chats:event` and reloads on `result` and `error`. That is the shape to copy.

## What is already decided

The diff filters events by workspace and debounces them, and does nothing while
its tab is hidden. The badge cannot take the last part — it is always on screen —
so it needs the debounce and nothing else.

## Sketch

`useWorkspaces` subscribes to the same events and refreshes the project the
workspace belongs to. Note it re-reads every workspace of every project today,
which is one `git status` per workspace; a turn ending is a poor reason to run
all of them, so this probably wants a narrower read first.
