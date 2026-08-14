# The chat draws a change the way the diff used to

**Found:** 2026-08-15, while fixing the diff pane's invisible characters.

## What happens

`ChangeBlock` in `ChatLog.tsx` draws an edit the agent made: the path, and the
lines under it. Both go on screen as plain text, so a right-to-left override
reorders what is read and a zero-width character draws as nothing — exactly
what the Changes tab no longer does.

The chat is where an edit is seen **first**, and often the only place it is
seen: a two-line change is read in the conversation and never opened in the
diff at all.

## Why it matters

Half a fix is worse than none here. The reviewer now has a pane that marks such
a line and a pane beside it that does not, so a line looking ordinary in the
chat says nothing about whether it is.

## Evidence

- `src/renderer/src/components/chat/ChatLog.tsx` — `ChangeBlock` renders
  `{change.path}` and `{line.text}` straight into spans.
- `src/renderer/src/components/diff/shown.tsx` — the function the diff pane
  uses, which is all this needs.

## What is already decided

The set of characters and the way they are drawn were settled for the diff
pane: bidi controls and the invisible formatting characters, minus U+200C and
U+200D, replaced by a chip naming the code point. This should reuse that rather
than reopen it.
