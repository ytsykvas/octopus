# The diff redraws itself once for every file it colours

**Found:** 2026-08-14, in the review of the diff viewer.

## What happens

`useHighlighting` walks the files one at a time and calls
`setTokens(new Map(collected))` after each. The map is cumulative, so file _n_
copies the tokens of all _n_ files before it, and every one of those calls
re-renders the whole pane: no component under `DiffPanel` is memoised, so every
file, every hunk and every row runs again.

A forty-file change is forty full re-renders of the diff and forty copies of a
map that grows to the total number of lines.

## Why it matters

It is the one thing standing between this pane and being pleasant on a large
change, and it is the same mistake already recorded against the chat log in
[the-log-is-recomputed-on-every-streamed-chunk.md](the-log-is-recomputed-on-every-streamed-chunk.md).
The plan this pane was built from called for `React.memo` on `DiffFile`, and it
did not get it.

Dragging the pane's edge has the same shape: the width is component state, so
every pointer move re-renders every row.

## Evidence

- `src/renderer/src/components/diff/useHighlighting.ts` — `setTokens(new Map(collected))`
  inside the per-file loop.
- `src/renderer/src/components/diff/*.tsx` — `grep -n memo` finds nothing.
- `src/renderer/src/components/RightPanel.tsx` — `applied` changes on every
  pointer move during a drag and is passed straight down to `DiffPanel`.

## What is already decided

Colours arrive after the diff is drawn, and files are done one at a time so that
no single tokenising holds a frame. That much is right; what is wrong is what
each arrival costs.

## Sketch

Return `Map<path, Map<DiffLine, Token[]>>` from the hook so each file's tokens
have their own identity, then `React.memo` on `DiffFile`. Only the file whose
colours just arrived would re-render. The pane's width reaches `DiffPanel` only
to decide whether two columns fit, so it could be reduced to that boolean before
it is passed down, and the drag would stop reaching the rows at all.

Measure before and after on a real change of several hundred files — the point
is the number, not the pattern.
