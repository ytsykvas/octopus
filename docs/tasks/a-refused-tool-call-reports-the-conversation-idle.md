# A refused tool call reports the conversation idle while the agent works on

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`answerPermission` on `'deny'` resolves the blocked call with the user's own
words and then writes `setChatStatus(request.chatId, 'idle')`. Nothing puts it
back: of the nine `setChatStatus` sites in `service.ts`, only `sendToChat`, the
allow path and `answerQuestions` write `running`, and **no agent event maps to
it**. So the conversation stays `idle` — and its workspace with it, through
`workspaceStatusFrom` — for the whole remainder of the turn.

But the turn does not end at a refusal, and the SDK's own types prove it rather
than merely the prose: the deny arm of `PermissionResult` is
`{ behavior: 'deny'; message: string; interrupt?: boolean; ... }`, and
`agent.ts:397` returns it **without** `interrupt`. Un-interrupted, a denial is
handed to the model as a tool result and the same turn carries on.

This is not an occasional path. The plan dialog's "keep planning" — Escape and
the close button included — is a deny with feedback. Every plan revision runs
with the conversation recorded as `idle` while the agent replans.

## Why it matters

Deny-with-feedback is the app's steering mechanism, and it is exactly the case
where the agent then does the most work. A grey dot beside an agent editing files
is the one thing the workspace list exists to get right.

The stop button goes with it, though only in a pane that did not send **and** was
already mounted when the request arrived: the pane that sent keeps `busy` true
(`answer` deliberately never clears it), and a pane that mounted while the
request was pending sets `busy` from `pendingPermission`. The sidebar dot is lost
for everyone.

## Evidence

- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2167-2178` — `interrupt`
  is the flag that ends a turn.
- `src/core/agent.ts:395-397` — `canUseTool` returns deny without it.
- `src/core/service.ts:3262-3274` — the deny branch: resolve, then
  `setChatStatus(..., 'idle')`, then `return`.
- `src/core/service.ts:1403-1420` — `setChatStatus` returns early when unchanged,
  so the eventual `result` write emits no event at all.
- `src/core/service.ts:1505-1560` — all of `handleEvent`'s status handling. No
  event maps to `running`.
- `src/renderer/src/components/chat/ChatSession.tsx:219` and
  `PlanDialog.tsx:38-49` — "keep planning" is a deny carrying feedback.
- `src/renderer/src/hooks/useChat.ts:253-258` — the `permission_request` handler
  sets `pending` but not `busy`; `Composer.tsx:481-497` renders stop only on
  `busy`.
- `src/core/service.test.ts:4970-4983` — the test and comment recording the wrong
  premise, "Declining ends the turn rather than continuing it". The fake's `ask`
  (`:2885-2889`) calls `canUseTool` and emits nothing afterwards, so no test can
  tell a continued turn from an ended one.
- `docs/ipc.md:150` — "how the plan dialog's 'keep planning' sends a correction
  without costing a turn".

## What is already decided

**Do not reach for `interrupt: true`.** It would make the status write honest and
destroy deny-with-feedback as a steering mechanism, and with it the plan dialog's
"keep planning", which is documented as first-class.

**Deleting the line is also wrong.** Without a write the chat stays at
`waiting_permission` for the rest of the turn, which is a worse lie than `idle`:
`workspaceStatusFrom` ranks it above `running`, so the sidebar would show the
amber "come and answer this" dot against a question nobody can answer any more.

No second site carries this. `abandonPermissions` (`service.ts:1650-1657`)
resolves outstanding requests without touching status, and both callers write the
right status themselves.

## Sketch

Write `'running'`, symmetric with the allow path and the questions path. It is
self-correcting: the turn always ends in a `result`, which writes `idle`/`error`,
and `settleStatuses` (`store.ts:296-303`) turns a `running` left by a crash into
`idle` at load.

The fake has to grow for the new test to mean anything. Flipping the expected
string to `'running'` still cannot distinguish the two worlds, because `ask`
emits nothing after the denial. The meaningful test denies, then uses `emit` to
push a further assistant message and finally a `result`, asserting `'running'` in
between and `'idle'` after. Add the mirror case, so the fix cannot strand a
workspace spinning.
