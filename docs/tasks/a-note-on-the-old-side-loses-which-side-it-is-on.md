# A note about the file as it was goes out naming a line in the file as it is

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

A diff note carries its side all the way through the pane. `anchorOf` gives a
note on a removed line `side: 'old'`; `SplitHalf` addresses the left column as
`lineAddress(path, 'old', line.oldNumber)`; `selectionAnchor` keeps the side the
selection started on; `anchorKey` spells path, side and both ends; the aria-label
even says which file it means; and `DiffPanel.onSave` stores the anchor whole
with a quote read from that same side's text, so the quoted code is right.

Then `fromDiff` — the one function that turns a note into the text the agent
actually reads — writes `${note.path}:${lineRange(note)}` and drops `note.side`
entirely. A note on the old side goes out as `src/core/diff.ts:812`, where 812 is
a line number in the pre-change file.

Reachable two ways: the gutter trigger on a pure-deletion row, and a selection
begun in the left column or on a removed line.

## Why it matters

The agent is pointed at an address that does not contain the code the remark is
about. The quoted passage rescues it when the text is distinctive, but for a
short or repeated line (`}`, `return null`, a closing tag) the number is the only
disambiguator — and it is numbered in a file that no longer exists, the more so
on a large deletion where the two numberings have drifted by everything added
above.

For an old-side note that also covers context lines, the quoted text _does_ exist
in the working tree but at a different number: the case where the number and the
quote quietly disagree.

The pane knows the difference everywhere except the one place it is sent. The
suite even names the hazard as the reason to record the side —
`DiffPanel.test.tsx:969-971`, "sending the agent to that number in the current
file would point at whatever now sits in its place".

## Evidence

- `src/renderer/src/components/chat/attachments.ts:82` — the only formatter of a
  diff note, with no `note.side`; `lineRange` at `:103-107`.
- `src/renderer/src/components/diff/DiffPanel.tsx:264` and `:443-455` — the side
  is stored and the quote is read from the correct side.
- `src/renderer/src/components/diff/DiffPanel.test.tsx:869-897` and `:969-985` —
  both gestures driven to an `'old'` anchor, the second asserting
  `side: 'old', line: 2, code: 'was here'`.
- `src/renderer/src/components/diff/DiffHunk.tsx:114-120,145` — `SplitRowView`
  prefers the right-hand line, which is what keeps old anchors rare rather than
  absent.
- `src/renderer/src/i18n/locales/en.ts:549` — `commentIntro` is the whole of what
  precedes the notes, and it says nothing about sides.
- `src/renderer/src/components/chat/attachments.test.ts:10-18` — every fixture is
  `side: 'new'`, so the case is untested despite the coverage gate.

## What is already decided

**Do not translate the old number into a new one.** A removed line has no line in
the file as it now stands, which is exactly why `anchorOf` records `'old'`. The
header has to name the side instead, the way the aria-label already does ("of the
file as it was", `en.ts:540`).

Any such marker is text the user reads back in their own message, so it belongs
in `en.ts`/`uk.ts` and is passed in the way the intros already are
(`Composer.tsx:294-297`), not written inline in `attachments.ts`. `withNotes`
already takes a `NoteIntros` record built for precisely this.

## Sketch

`fromDiff` has the side in hand; it only has to say it. What it must not do is
print a bare number that means two different lines depending on a field it threw
away.

**A second place has the same gap**: the composer chip's label
(`ComposerAttachments.tsx:13-21`) also prints `basename:lines` with no side, so
two notes on the same number on opposite sides show identical chips before
sending — the one moment the omission is still correctable.

`docs/ui.md:1113` needs rewriting either way. As it sits in the paragraph
describing this message it reads as a promise about the message; its actual
subject (per `d055c76`) is anchor identity, now described at `docs/ui.md:1134`.
