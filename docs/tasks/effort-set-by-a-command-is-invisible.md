# Effort set by a command is invisible

## What happens

`/effort high` changes the reasoning level inside the CLI. Nothing in octopus
notices: the footer's effort picker goes on naming whatever the record holds,
and unlike the model there is no reading that reports the truth.

The model used to have this problem and no longer does — `getContextUsage()`
names the running model, and the footer shows it (see `docs/core.md`, "Which
model is running"). The same response carries no effort.

`setChatEffort` pushes the level at a running session, so changing it in the
picker does overwrite what a command set. But nothing re-asserts it per message
the way the mode is re-asserted, so a level set by `/effort` survives every
message after it — right next to a picker naming a different one.

## Why it matters

Effort is what a turn costs and how long it takes. A control that names a level
other than the one in force is consulted precisely when that matters, and it is
the second-most-read thing in the footer.

The asymmetry is its own problem: mode is re-asserted on every message, model is
read back and displayed, effort does neither. Three settings in one row, three
different policies, none of them written down where the row is.

## Evidence

`sendToChat` re-asserts `sessionMode(chat)` and nothing else.
`SDKControlGetContextUsageResponse`
(`sdk.d.ts:3223`) has `model` and no effort. `applyFlagSettings` — how effort is
set on a running session — returns `void`, so it cannot be read back either.

## A sketch

Cheapest honest fix: re-assert effort alongside the mode, which makes the three
consistent and costs one line. It does mean a command's effort lasts one turn,
which is the same bargain `/permissions` already lives with — and worth saying
in `docs/ui.md` rather than leaving to be discovered.

Reading it back would be better, but there is nothing to read it from; that
would need the SDK to report it, or a hook on `UserPromptSubmit` to notice the
command going past.
