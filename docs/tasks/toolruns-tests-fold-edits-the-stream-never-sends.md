# The `toolRuns` tests fold edits the stream never sends

## What happens

The `call()` helper builds every tool call with `input: { file_path: '/a.ts' }`
(`toolRuns.test.ts:12-13`). An `Edit` shaped that way carries no `old_string` or
`new_string`, so `readChange` returns null and it folds like a grep. The test at
`toolRuns.test.ts:60` asserts exactly that: `['tools', 'entry', 'tools']`, where
a real `Edit` gives `['tools', 'entry', 'change', 'change']`.

## Why it matters

It documents the opposite of what the module does, in the file whose job is to
explain how a run is broken up — next to the test named "never folds away a
change to a file". Anyone reading it to learn the rule learns the wrong one, and
if the classification ever broke, this test would agree with the break.

## A sketch

Give `call()` edit-shaped input when the name is `Edit` or `Write`, or use the
`edit()` helper already defined further down the file, and correct the
expectation.
