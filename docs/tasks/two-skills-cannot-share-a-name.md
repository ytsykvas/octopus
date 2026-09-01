# Two skills cannot share a name

A skill is keyed by its bare name wherever it came from — the installation's
store, a project's, or the checkout's `.claude/skills`. Two of them called
`review` are one row in the panel, one entry in the default lists, and one key
in a conversation's overrides.

## Why it matters

Nothing stops it happening. The name is checked for uniqueness **within its own
store** (`skills.ts`, `refuseExisting`), which is the wrong scope: a global
`review` and a project `review` are both accepted, and after that switching
either one switches both.

## Evidence

Measured against a live session: a `local-probe` in the checkout and a
`local-probe` in a store handed over as an extra root came back from
`getContextUsage()` as a **single** row. The CLI dedupes them, so the panel is
not wrong about the agent — it is the app that allowed two files to be created
for one skill.

## What is already decided

The key stays the bare name. It is what the agent calls the skill, and a key
that distinguished two skills the CLI cannot tell apart would describe
something that does not exist.

## A sketch

`refuseExisting` should ask the wider question: is this name taken in the other
store, or in the checkout the dialog was opened against? The uniqueness table in
the `core-module` skill is the right place to record the answer — this is the
fourth bug in this project with exactly that shape.
