# Effort cannot differ between planning and writing

## What happens

A conversation now holds two models — `model` and `planModel` — and
`sessionModel` folds them, so planning can run on one model and the work on
another. Effort has no such pair: `chat.effort` is one level, and it is what
both halves run at.

## Why it matters

The reason for the model split applies to effort word for word, and arguably
harder. Someone who wants Opus to think an approach through and Sonnet to carry
it out wants **more** thinking in the first half and less in the second — that
is the same judgement, and half of it is now expressible and half is not.

It also costs money in the direction nobody wants: leaving effort at the level
planning needed means every file edit after the plan is approved is paid for at
that level.

## What is already there to build on

Almost all of it. `sessionModel` in `chats.ts` is the shape — a fold of two
stored fields into the one thing the SDK takes — and `pushModel` in `service.ts`
is the mechanic, a guarded push on the two moments the effective value moves
(planning toggled, plan approved). Both would be duplicated rather than
invented, which is itself the argument for doing it: a second copy is a cue to
look at whether one function can carry both.

The control is the awkward half. Effort is a scale in a panel of its own now —
`EffortPicker`, with `ultracode` past the end and a picture above it — so the
shape is no longer the problem it was when this note was written. Two of them
side by side is: a panel per job would be two scales and two octopuses in a
window that argues for calm, and the picture is most of the panel's height.

Either the scale grows a second marker, or it grows a pair of tabs naming the
job. The first says the relationship — plan here, code there, on one rule — and
is the reason to look at this again rather than copy the model panel's two
columns. Which is a design question, and the reason this stays a note.

## What blocks doing it blind

`docs/tasks/effort-set-by-a-command-is-invisible.md` — `/effort high` changes the
level inside the CLI and nothing here notices, and unlike the model there is no
reading that reports the truth. A split built on top of a value that can already
be wrong would make two settings wrong instead of one. That one comes first.
