# A turn in flight cannot be stopped after a workspace switch

## What happens

Send a long message in workspace A, click workspace B while the agent works,
click back to A. The streamed text keeps arriving and the log fills in — but the
composer shows the send arrow, not the stop square, so the running turn cannot
be interrupted at all.

`useChat` resets `busy` to false whenever the workspace changes
(`useChat.ts:68-80`), and the only thing that turns it back on when the pane
reopens is a pending permission (`useChat.ts:123-127`). A turn that is merely
working — not blocked on a question — has nothing to restore it.

## Why it matters

The one control that stops an agent editing files is missing exactly when the
user has come back to check on it. The workspace list next to it says
`running`, so the window disagrees with itself.

## Already decided

`chats:pending` exists because `permission_request` goes out once; the same
argument applies here. Either seed `busy` from the workspace's own status —
`running` or `waiting_permission`, which `Chat` already receives — or widen
that channel to answer "a turn is in flight" as well as "blocked on this".
The status is already broadcast, so the first costs no new IPC.
