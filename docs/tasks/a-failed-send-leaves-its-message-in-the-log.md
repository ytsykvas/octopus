# A failed send leaves its message in the log

**Found:** 2026-08-18, while making the composer clear a review only once the
message has gone.

## What happens

`useChat.send` draws the user's message in the log before the round trip, on
purpose: the message is the user's own, and waiting for the disk to confirm it
makes typing feel unresponsive.

When the send then fails, the entry stays. Nothing removes it, and nothing wrote
it to the transcript — `chats.send` is what would have appended it, and it is
what failed. So the pane shows a message that exists nowhere else: reopen the
conversation and it is gone.

## Why it matters

The log is the record of what was said. A line in it that no file carries is the
one kind of wrong a reader cannot catch, because the log is the only thing they
have to check against.

It also reads as though the message went and the agent ignored it, which is the
same misreading `a-model-swapped-by-a-refusal-goes-unmentioned.md` describes: a
turn that looks ordinary and behaves as if it were not.

The composer now keeps the typed text on a failed send, which makes the pair
visible — the message is in the field and in the log at the same time, and only
one of them is true.

## Evidence

- `src/renderer/src/hooks/useChat.ts` — `send`, the `setEntries` call above the
  `await`, and the `!sent.ok` arm below it which sets an error and nothing else.
- `src/renderer/src/components/chat/Composer.tsx` — `submit`, which now clears
  only on a successful send.

## What is already decided

Drawing the entry optimistically stays. Waiting for the round trip to show the
user their own message is the responsiveness this deliberately bought, and the
failure is the rare case.

## Sketch

Take the entry back out when the send fails — `setEntries` already holds the
list, and the failed one is the last of them. Worth checking at the same time
whether the error line that appears is enough on its own, in which case removing
the entry and leaving the error is the whole fix.
