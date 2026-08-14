# A diff line can read differently from how it runs

**Found:** 2026-08-14, in the review of the diff viewer.

## What happens

A diff line is put on screen as text, and the browser applies the Unicode
bidirectional algorithm to it. A right-to-left override in the source reorders
what the reviewer sees without changing what the compiler reads — the Trojan
Source trick. Zero-width and other invisible characters are drawn as nothing at
all.

Nothing is executed and nothing is injected: React escapes the markup. The
problem is narrower and worse suited to being ignored — the reviewer approves a
line that is not the line.

## Why it matters

This pane exists to be the place work is checked before it is merged, and the
code in it is written by an agent. A review surface that can be made to show
something other than the bytes is not doing the one job it has.

## Evidence

- `src/renderer/src/components/diff/DiffHunk.tsx` — `Code` renders
  `{token.text}` or `{text}` straight into a span.
- The same applies to the file header, which draws the path, and to the review
  note, which quotes the line back into the prompt.

## What is already decided

Text is drawn as text; nothing here interprets markup, and that is not in
question.

## Sketch

Mark the runs rather than stripping them: GitHub shows a warning on a file whose
lines contain bidi controls, and renders the characters visibly rather than
silently. `unicode-bidi: plaintext` on the row does not help — the override is
inside the line. The smallest honest version is a badge on the file header when
any line contains a character in the bidi-control or zero-width ranges, so the
reviewer knows to read that file somewhere else.
