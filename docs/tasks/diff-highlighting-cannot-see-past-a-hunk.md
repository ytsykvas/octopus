# Syntax colours cannot see past a hunk

**Found:** 2026-08-14, while building the diff viewer.

## What happens

Each side of a file is tokenised as one document built from that file's hunks,
joined end to end. The lines between two hunks are not in it. A construct that
opens before the first hunk — a block comment, a template literal, a heredoc, a
JSX element — is invisible to the highlighter, so the lines after it can be
coloured as though they were ordinary code.

## Why it matters

It is a courtesy rather than information, and a wrongly coloured line is not
misleading the way a wrong line number would be. But it is most likely to happen
in exactly the files worth reading closely: a hunk in the middle of a long
function, three lines of context either side, and everything that gave those
lines their meaning left out.

## Evidence

- `src/renderer/src/components/diff/sides.ts:23-35` — `sideTexts` walks the
  hunks and joins them; the comment at `:13-16` states the limit.
- `src/renderer/src/components/diff/useHighlighting.ts:73-76` — one `highlight`
  call per side per file, over that joined text. A file with no grammar or no
  hunks is skipped at `:69`, and one carrying a line longer than 2,000
  characters at `:70`, so the mis-colouring only shows in the files that are
  coloured at all.

## What is already decided

Tokenising a side whole rather than line by line, which is what makes multi-line
constructs correct _within_ a hunk. Per-line tokenising was never on the table:
it gets a block comment wrong from its second line onwards.

## Sketch

Read the whole file from the worktree and tokenise that, then slice the rows the
hunks point at. It costs a file read and a full tokenising per file, against a
budget the core already caps at 20,000 drawn lines — so measure before assuming
it is too expensive. Both sides need it, and the old side is not on disk, which
is the part that makes this more than an afternoon: it would have to come from
`git show <merge-base>:<path>`, one more process per file.
