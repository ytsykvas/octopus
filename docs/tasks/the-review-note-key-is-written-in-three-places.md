# The anchor of a review note is written out in three places

**Found:** 2026-08-14, in the review of the diff viewer.

## What happens

`${path}:${side}:${line}` is what makes two notes the same note. It is built
independently in three modules, and nothing ties them together.

## Why it matters

The project's rule is that the third repetition is the cue to abstract, and this
is the third. It is also the kind of duplication that fails quietly: change the
separator or add a field in one place and notes stop deduplicating, or a chip
stops matching the line it belongs to, with nothing failing to say so.

## Evidence

- `src/renderer/src/hooks/useDiffComments.ts` — `keyOf`.
- `src/renderer/src/components/diff/CommentedRow.tsx` — `anchorKey`.
- `src/renderer/src/components/chat/ComposerAttachments.tsx` — inline, in the
  `key` of the chip.

## What is already decided

One line takes one note, and the anchor is what says so. That is the design, not
the problem.

## Sketch

Export `anchorKey` from `useDiffComments.ts` — where the type lives — and have
the other two call it. A test that two notes on the same line collapse into one
already exists; what is missing is anything holding the three spellings
together, which is what a single function is.
