# A command added mid-conversation may not be offered until the next one

**Found:** 2026-09-07, on building the commands and subagents catalogue. Written
because the alternative was to assume, and the whole reason the catalogue turned
out small was that somebody measured instead.

## What happens

Writing a command or a subagent calls `refreshRunningSkills()`, which is
`Query.reloadSkills()` on every live session. Whether that reaches the two new
directories is **half known**:

- **Commands: likely, on the SDK's own word.** `SessionStartHookSpecificOutput`
  describes its `reloadSkills` flag as "re-scan skill **and command**
  directories after SessionStart hooks complete" (`sdk.d.ts:4940`). The same
  control backs `Query.reloadSkills()`, whose own docstring says skills only
  (`sdk.d.ts:2519-2524`). One of the two sentences is incomplete and the
  optimistic reading is untested.
- **Subagents: unknown.** Nothing in `sdk.d.ts` says a reload touches
  `.claude/agents/`, and `supportedAgents()` is still never called — so octopus
  could not tell either way even if it did.

So the honest statement today is: a command or subagent written from Settings is
certainly there for the **next** conversation, and possibly for the ones already
running.

## Why it matters

Little, and it is worth saying why rather than leaving it to be rediscovered.
Somebody who has just written a command wants to use it, and the conversation
they want to use it in is the one that is open. If the reload does not reach it,
the app looks broken in exactly the way that costs a bug report: the row is in
Settings, the slash menu has not heard of it.

Nothing is lost either way — the next session sees it — so this is a wait, not a
failure.

## How to answer it

The same shape as the measurement that shrank this feature in the first place:
start a real session against a scratch data root, write a command and a subagent
into the store **after** the session is up, call `reloadSkills()`, then
`supportedCommands()` and `supportedAgents()` and read the lists.

`agent.ts` already exposes `refreshSkills()` and `supportedCommands()`; the
subagent half needs `Query.supportedAgents()` called for the first time, which is
three lines and is worth having anyway — the skills panel does the same
reconciliation for skills.

## What follows from each answer

- **Both reload:** delete this note and say so in `docs/ui.md`.
- **Commands only:** the subagent sections say that a new one arrives with the
  next conversation. One sentence, drawn where it is true.
- **Neither:** the same sentence on both, and the reload call goes — a call that
  buys nothing is a claim the code makes and does not keep.
