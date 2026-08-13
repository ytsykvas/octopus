# `replace_all` is drawn as a single replacement

## What happens

`Edit` accepts `replace_all`, and the agent uses it for renames. `EditSchema` in
`changeSummary.ts:17-21` does not read the flag, so the log draws one removed
line, one added line, and a header saying `+1 −1` — for a call that changed
twelve places in the file.

## Why it matters

The change block is what the user reviews instead of reading the diff. It is
not merely incomplete here: it states a count, and the count is wrong.

## A sketch

Add `replace_all: z.boolean().optional()` and, when it is true, stop asserting a
number the call cannot support — carry the flag on `Change` and have
`ChangeBlock` say the text was replaced everywhere it appeared.
