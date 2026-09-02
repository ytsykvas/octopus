# A failed send leaves its message in the log

**Found:** 2026-08-18, while making the composer clear a review only once the
message has gone.

## What happens

`useChat.send` draws the user's message in the log before the round trip, on
purpose: the message is the user's own, and waiting for the disk to confirm it
makes typing feel unresponsive.

When the send then fails, the entry stays. Whether anything else carries it
depends on where the failure was. `sendToChat` appends the message to the
transcript before it re-asserts the mode or starts a session, deliberately —
the comment above the append says the message should survive a session that
would not start.

A failure before that point — the IPC refusing the text, `requireChat` or
`requireWorkspace` throwing, the append itself failing — leaves the pane
showing a message that exists nowhere else: reopen the conversation and it is
gone. After it, which is the commoner half, the message is in the transcript
and the composer still holds the text, so pressing send again appends the same
message a second time.

## Why it matters

The log is the record of what was said. A line in it that no file carries is the
one kind of wrong a reader cannot catch, because the log is the only thing they
have to check against.

It also reads as though the message went and the agent ignored it, which is the
same misreading `a-model-swapped-by-a-refusal-goes-unmentioned.md` describes: a
turn that looks ordinary and behaves as if it were not.

The composer now keeps the typed text on a failed send, which makes the pair
visible — the message is in the field and in the log at the same time, and
where nothing was written down only one of them is true.

## Evidence

- `src/renderer/src/hooks/useChat.ts:300-322` — `send`, the `setEntries` call at
  :307 above the `await`, and the `!sent.ok` arm at :313-317 below it, which
  sets an error, clears `busy` and returns false to the composer.
- `src/renderer/src/components/chat/Composer.tsx:275-304` — `submit`, which now
  clears only on a successful send.
- `src/core/service.ts:3075` — the append, above the mode and the session start,
  with the comment saying why it is there.
- `src/main/ipc.ts:601` — `chats:send`, where the text is parsed; a refusal
  there never reaches the append.

## What is already decided

Drawing the entry optimistically stays. Waiting for the round trip to show the
user their own message is the responsiveness this deliberately bought, and the
failure is the rare case.

## Sketch

Take the entry back out when the send fails — `setEntries` already holds the
list, and the failed one is the last of them. Only right for a failure that
never reached the transcript, and the result the renderer gets does not say
which happened: `attempt` returns a message and sometimes a code, never how far
the call got. Worth checking at the same time whether the error line that
appears is enough on its own, in which case removing the entry and leaving the
error is the whole fix.
