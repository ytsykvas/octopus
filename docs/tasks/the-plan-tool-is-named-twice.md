# The plan tool is named twice

## What happens

`chats.ts` exports `EXIT_PLAN_MODE` precisely so the renderer can share the
name, and `useChat` imports it. `toolSummary.ts:35` compares against the string
`'ExitPlanMode'` instead.

## Why it matters

The name belongs to the SDK, and its behaviour has already changed once. When it
is renamed, the constant will be updated — the core will strip the new name from
standing approvals and clear `planMode` on approval — while `readPlan` keeps
matching the old one. The plan then renders as an ordinary tool call: no dialog,
no approval, the turn simply stops.

## A sketch

Import the constant, or add a test asserting `readPlan(EXIT_PLAN_MODE, …)` is
non-null so the two names cannot drift apart in silence.
