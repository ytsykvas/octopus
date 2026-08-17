# A turn ending in one project cancels another project's change-count re-read

**Found:** 2026-08-17, while adding several conversations per workspace.

## What happens

`useWorkspaces` re-reads a project's workspaces 300ms after a turn ends there,
so the change count on the row follows the work. The pending re-read is held in
a single ref, and every qualifying event clears it — whichever project the event
came from.

Two turns finishing within 300ms in **different projects** therefore leave one
of them without a re-read at all: the second event cancels the first's timer and
schedules its own for its own project. The first project's rows go on showing
the count they had before the agent touched anything.

## Why it matters

It is already reachable today — this application's whole premise is that several
agents work at once — but it needed two projects open and two turns landing
together. Three conversations per workspace make turns end far more often, and
a stale change count sits directly beside a diff pane that re-read itself on the
same event, so the window disagrees with itself.

Nothing corrects it until something else refreshes the list: creating, renaming
or removing a workspace, or another turn ending in that project.

## Evidence

- `src/renderer/src/hooks/useWorkspaces.ts:75` — `const settle = useRef<ReturnType<typeof setTimeout> | null>(null)`, one timer for every project.
- `src/renderer/src/hooks/useWorkspaces.ts:99-107` — `clearTimeout(settle.current)` runs before the project id is even consulted, and the new timeout closes over that event's `projectId`.

## What is already decided

The re-read is deliberately debounced and deliberately per project: a turn
ending is a poor reason to run `git status` over every workspace of every
project. Neither of those changes.

## Sketch

A `Map<projectId, timeout>` in place of the ref, cleared per project on set and
all of them on unmount. The debounce window and the event filter stay as they
are.
