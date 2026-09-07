# A class with no token behind it colours nothing

**Found:** 2026-09-07, while styling the conversation filter in the changes
pane. The first version copied `EffortPicker`'s selected state, and the copy is
what made it visible: the class does nothing.

## What happens

`EffortPicker.tsx:348` draws the chosen effort with
`border-accent bg-accent-bg text-ink`. `bg-accent-bg` needs a `--color-accent-bg`
token, and there is none — `styles.css` defines `--color-accent` and
`--color-accent-hover` and nothing else in that family. Tailwind emits no rule
for a colour it cannot resolve, and no error either.

So the chosen job tab is marked by its border and its text colour alone. That is
legible, which is why nobody has noticed, but it is not what the code says it is
and it is quieter than every other chosen-of-several control here: the usage
card's spans and the project colour cells both fill.

## Why it matters

Little on its own, more as a pattern. A class name that resolves to nothing is
invisible to the type checker, to the linter and to a reader — the fix was found
only by copying it somewhere the missing fill was obvious. Anywhere else in this
repository, a colour that does not exist is a compile error; in a class string it
is silence.

## What is already decided

The filter strip in `DiffPanel` uses `bg-muted text-ink`, which is what the
usage card's spans use and what a chosen chip looks like here. That is the
answer for a chip.

## Sketch

Two ways, and the choice is a design one:

- **Define `--accent-bg`** — a low-alpha accent, light and dark — and let the
  job tabs fill as they were written to. This is the larger change: the token
  joins the palette and the next control reaches for it too.
- **Drop the class** from `EffortPicker` and let the border and the text carry
  the state, which is what actually happens today, written down honestly.

Worth doing when the composer's settings are next opened. While it waits, the
useful half of this note is the general one: **a Tailwind colour class is not
checked by anything**, so a new one is worth grepping `styles.css` for before it
is written.
