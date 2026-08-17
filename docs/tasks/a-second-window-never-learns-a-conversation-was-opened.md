# A second window never learns a conversation was opened or closed

**Found:** 2026-08-17, while adding several conversations per workspace.

## What happens

`chats.list` is read once when a workspace is selected, and nothing announces
that the set of conversations has changed. `chats:status` carries what a
conversation is doing, not whether it exists.

So with two windows on the same workspace: window A presses `+` and gets a third
tab; window B goes on drawing two, indefinitely. The same in reverse — B keeps
drawing a tab whose conversation A has closed, and clicking it reads a history
that is gone.

Pressing `+` in B then fails against a cap it cannot see, with "A workspace holds
at most 3 conversations" over a strip showing two.

## Why it matters

Two windows on one workspace is a supported arrangement — it is why agent events
are broadcast rather than answered to the caller
(`src/main/ipc.ts`, `broadcastChatEvent`). The gap existed before this change
too, for the creation of the first conversation, but with one tab it was
invisible: the second window would create the same record and `openChat` is
idempotent.

## Evidence

- `src/renderer/src/hooks/useChatTabs.ts` — `load` runs from an effect keyed on the workspace, and from `create`/`fork`/`close` in the window that did them. Nothing else calls it.
- `src/core/service.ts` — `createChat`, `forkChat` and `closeChat` commit and return; only `setChatStatus` reaches `chatStatusListeners`.
- `docs/ipc.md` — the three broadcast channels, none of which carries membership.

## What is already decided

The status stream stays what it is: a status, per conversation, announced only
when it moves. Widening it to mean "and by the way the list changed" would make
every window re-read on every turn.

## Sketch

Either a fourth broadcast — `chats:changed` carrying the workspace id, sent by
the three writers — with `useChatTabs` re-reading its own workspace on it; or
have the status stream carry enough for a window to notice an id it does not
know and re-read then. The first is simpler and says what it means; the second
adds no channel but only covers appearances, not disappearances.
