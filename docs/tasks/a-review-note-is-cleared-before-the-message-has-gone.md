# A review note is cleared before the message is known to have gone

**Found:** 2026-08-14, in the review of the diff viewer.

## What happens

The composer builds the message, calls `onSend`, and clears the notes on the
next line. `onSend` returns nothing and the send is fire-and-forget, so a
failure — no session, the agent busy, the IPC call refused — takes the review
with it. The notes are not persisted, so there is nowhere to get them back from.

## Why it matters

A review is minutes of reading. Losing it to a failed send is worse than losing
a typed message, which at least is short and fresh in mind.

## Evidence

- `src/renderer/src/components/chat/Composer.tsx` — `onSend(...)` then
  `onCommentsSent()`, unconditionally.
- `src/renderer/src/components/chat/Chat.tsx` — `onSend={(text) => void chat.send(text)}`;
  the `void` is where the outcome goes.
- `src/renderer/src/hooks/useDiffComments.ts` — nothing is written to disk.

## What is already decided

Not persisting the notes is deliberate: a note points at a line that is about to
change. That decision is about surviving a restart, and says nothing about
surviving a send that failed a moment ago.

## Sketch

Make `onSend` answer whether the message went, and clear only then. The draft in
the composer has the same shape and the same question, so whatever is done here
should cover both — note that `useChat.send` already reports failures through
`describeFailure`, so the outcome exists and is being dropped on the way back.
