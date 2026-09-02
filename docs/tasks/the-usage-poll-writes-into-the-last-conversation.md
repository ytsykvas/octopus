# A usage probe that cannot spawn reports it into somebody else's conversation

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`askAccount` starts its probe in `state.chats.at(-1)` through `startFor`, which
wires the session into the ordinary `handleEvent`. Nothing marks it as a probe.

In normal operation that leaves no trace: a session with no user message emits no
SDK messages at all. Driven against the real SDK exactly as `askAccount` drives
it — a prompt generator that never yields, then the usage control request, then
`close()` — the control request answered in 1.6s and the message stream produced
**zero** messages. The CLI emits its `init` when a turn starts, not when the
process spawns, which is also what `docs/core.md:260` says.

The one path that does leave a trace is a stream that **throws**. `agent.ts:435-440`
turns a failed spawn into `{ type: 'error' }`; for the probe that lands in the
last chat's transcript and sets it to `error`, which `workspaceStatusFrom` turns
into a red workspace row. Reproduced by pointing the session at a cwd that no
longer exists — a worktree removed from under the app — where the SDK throws
"native binary … failed to launch".

The sidebar's three-minute timer and its focus listener repeat it, so a
conversation nobody spoke in collects the same error row indefinitely, and the
message names the agent binary rather than the missing worktree.

`state.chats.at(-1)` is the last chat in the **whole state**, not in the project
on screen, so the row can appear in a project the user is not even looking at.

## Why it matters

Low, because it fires only when the environment is already broken and clears the
moment anything else moves the chat — but the transcript lines stay, and the
failure is attributed to the wrong thing entirely: the user reads it as their
agent breaking.

The sidebar already learns of the failure properly — `readUsageReport` swallows
the control-request failure and `readWindows` returns `{ kind: 'failed' }`, which
the account block has a sentence for. The chat copy is pure misattribution.

`docs/ui.md:903-908` describes the probe as bookkeeping "shut in a `finally`" and
says nothing about it landing in a conversation.

## Evidence

- `src/core/service.ts:1181` — `const chat = state.chats.at(-1)`.
- `src/core/service.ts:1185` and `:1992-1996` — the probe gets the ordinary
  `onEvent: (event) => handleEvent(...)`.
- `src/core/agent.ts:435-440` — a failed spawn becomes an `error` event.
- `src/core/service.ts:1484-1485` and `:1555-1557` — recorded into that chat's
  transcript, and the chat set to `error`.
- `src/core/store.ts:275` with `store.test.ts:802` — one chat in `error` makes
  the whole workspace `error`.
- `src/core/agent.ts:474-476` with `:252-262` — `readUsageReport` already
  catches, so the sidebar gets `{ kind: 'failed' }` with no chat involved.
- `src/renderer/src/hooks/useSubscriptionUsage.ts:15` and `:119-124` — the
  three-minute timer plus `focus`/`visibilitychange`.

## What is already decided

The comment at `agent.ts:436-438` — "the chat is the only place the user is
looking" — is true of a session the user is talking to and not of a probe, so
silencing the probe's stream loses nothing. What must **not** be silenced is the
other `startFor` caller, `sendToChat` at `service.ts:3154`, where somebody typed
a message and the error genuinely belongs in the log.

`init` never arrives for a probe, and `ChatLog` draws nothing for a
`session_started` even when one is recorded (`ChatLog.test.tsx:622-632`). So
there is no growing transcript and no "started" dot to fix — only the error path.

## Sketch

Give the probe its own event sink. `startSession` takes `onEvent`, so `askAccount`
can pass a handler that drops everything and never touches `record`,
`setChatStatus` or the chat record.

That also removes a second hazard on the same lines: while the probe sits in
`sessions` under a real chat id, a `sendToChat` for that chat adopts it
(`service.ts:3153`), and the probe's `finally` (`:1191-1193`) then deletes and
closes the session the message was just handed to.

Two marks a filter on events alone will not remove: `startFor` calls
`session.commands()` and `rememberCommands` commits `knownCommands` onto that
chat (`service.ts:1462-1467`), and `session.models()` can rewrite the model
catalogue. Both are harmless — same worktree, same account — but they are writes
attributed to a conversation nobody spoke in.

**Do not test it the way it was first reproduced.** Emitting a fake `init` for a
probe asserts a state the CLI never produces. The honest test is a fake query
whose stream throws with no message ever emitted — `finish(new Error(...))` on
the harness at `service.test.ts:2828` does exactly that — asserting the last
chat's transcript stays empty and its status stays `idle`.
