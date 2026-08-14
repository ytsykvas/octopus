# A half-written review note is lost when the diff reloads

**Found:** 2026-08-14, in the review of the diff viewer.

## What happens

The diff re-reads itself when the agent finishes a turn. The rows are keyed by
their index within a hunk, so a line that has moved is drawn by a component that
was holding a different line. The note editor's text is local to that component,
and the open editor is tracked by `path:side:line` — which the moved line no
longer matches. The half-written note disappears, and there is nothing on screen
to say why.

Closing the editor also drops focus to `<body>` rather than returning it to the
trigger it was opened from, so a keyboard user restarts from the top of the pane.

## Why it matters

Writing a note is exactly what someone is doing while the agent is still working,
which is exactly when the reload happens. Losing the sentence being typed is the
worst possible moment to lose anything.

## Evidence

- `src/renderer/src/components/diff/DiffHunk.tsx` — `key={index}` on both the
  unified rows and the split ones.
- `src/renderer/src/components/diff/CommentedRow.tsx` — `Editor` holds `text` in
  its own state, seeded once from `initial`.
- `src/renderer/src/components/diff/DiffPanel.tsx` — `editing` is the anchor
  string, and `setEditing(null)` is not called on a reload; the editor simply
  stops matching.

## What is already decided

The reload on `result` is the feature, and the notes surviving a workspace
switch is deliberate (`useDiffComments` keys by workspace). A note that has been
_saved_ already survives a reload; this is only about one being typed.

## Sketch

Key a row by its anchor rather than by its index, so a line that stays keeps its
component. That leaves the case where the line genuinely goes: hold the draft in
`DiffPanel` beside `editing`, and it outlives the row either way. Returning
focus to the trigger is a ref and two lines.

Worth deciding at the same time: whether a reload should be held back at all
while a note is open, which would make the whole question smaller.
