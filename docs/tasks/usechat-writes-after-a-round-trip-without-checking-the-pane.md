# `useChat` writes state after a round trip without checking the pane

## What happens

Two bugs from one omission. The load effect guards every await with
`abandoned()` (`useChat.ts:83-88`); `ensureChat` (`useChat.ts:193`) and `change`
(`useChat.ts:272`) guard nothing.

1. **A chat leaks into another workspace's pane.** Workspace A has no record.
   Pick a model in A's composer, then click workspace B before the round trip
   returns — it is a control request to the CLI, easily over 100ms. `setChat`
   then lands on the pane now showing B, so B's log draws A's events and B's
   attic reports A's usage.

2. **A second setting reverts the first.** With a live session, pick a model and
   then an effort within a moment of each other. Both writes reach the core
   correctly, but `change` sets `{ ...target, ...patch }` from the snapshot it
   took _before_ its await (`useChat.ts:278`), so whichever answer lands last
   overwrites the other in the UI. The picker snaps back to a value the core no
   longer holds, and stays wrong until the pane reloads.

## Why it matters

The first draws one workspace's work under another's name — the one confusion
this application exists to prevent. The second makes the composer disagree with
what the agent will actually do.

## A sketch

The revert is a one-line fix: `setChat(current => current === null ? {...target,
...patch} : {...current, ...patch})`. The leak needs the load effect's guard
threading through both callbacks — capture `workspaceId` on entry and drop the
write if it has changed since.
