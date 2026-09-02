# Another conversation's slash commands replace this one's

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`useCommands` subscribes with `onChatEvent(handler)` and **no chat id**.
`chatEvents` treats a missing id as "wants everything", so the handler is woken
for every conversation in the window — every workspace, every project. On
`commands_changed` it calls `setCommands(announced.event.commands)` without
checking whose event it was.

It is the only per-chat subscriber that neither passes an id nor filters inside:
`useWorkspaceDiff` filters on `announced.workspaceId`, `useWorkspaces` matches
against the project list, `useSessionUsage` and `useChat` pass the id.
`useModels` and `useRateLimit` subscribe without an id too, but a model list and
a rate limit belong to the account, so they have nothing per-chat to filter.

**The leak is sticky.** Nothing restores the pane's own list. The render-time
reset and the read at `useCommands.ts:38-51` both fire only when `chatId`
changes, so the composer keeps offering the other project's commands until the
reader switches conversations or a `session_started` arrives for _this_ chat.

**Every pane of the open workspace is hit at once.** `Chat.tsx:181-189` mounts a
`ChatSession` for every tab (`visible` only hides it), and each calls
`useCommands`.

Only cross-worktree events do harm — sibling chats in one workspace share a
worktree and therefore the same `.claude/commands/`, so a same-workspace event
replaces the list with an identical one. The damage comes from another workspace
or another project, which is the arrangement the app exists for.

## Why it matters

The composer offers slash commands from another project's `.claude/commands/`,
which is exactly what the hook's own doc comment says must not happen: "a
project's own commands live in its `.claude/commands/`, so the answer belongs to
the worktree". Picking one sends a command this worktree does not define.

**The test written to prevent this passes while the leak is happening.**
`ignores what another chat was told` asserts `result.current` synchronously right
after `emit(...)` with no `act`/`waitFor`, so it reads the value from before
React flushes. Probe run of the shipped shape: the synchronous read returns
`["clear"]` (passes), and 20ms later the same `result.current` is `["deploy"]`.

The blast radius stops at the menu — `/clear` and `/usage` interception is
decided in core against the per-chat `chat.knownCommands`, not against this
renderer list, so a leaked list cannot misroute those.

## Evidence

- `src/renderer/src/hooks/useCommands.ts:56` — no second argument, and no
  `announced.chatId` comparison anywhere in the handler; `:61` — the unguarded
  `setCommands`; `:65` — `session_started` from any chat triggers a needless
  round trip (probe: mock calls went 1 → 2, both with `"chat-1"`).
- `src/renderer/src/hooks/chatEvents.ts:56` and `:36` — a handler with no id
  lands in `everything`, walked for every event.
- `src/core/service.ts:286-290` — `ChatEvent` carries `chatId` and `workspaceId`,
  so the comparison is available and simply not made.
- `src/core/agent.ts:538-539` — `commands_changed` is a recurring per-session SDK
  message, not a one-off.
- `src/renderer/src/hooks/useCommands.test.tsx:95-105` — the broken assertion,
  at `:104`.

## What is already decided

**Do not fix this by comparing ids inside the handler.** Passing the id to
`onChatEvent` is the fix the module was built for: `chatEvents.ts:10-13` records
that the whole point of the per-chat map was to stop every pane doing every other
conversation's work, and a filter inside the handler would leave the wake-up cost
the module exists to remove. `useWorkspaceDiff` filters inside only because it
keys on `workspaceId`, which the map does not index.

**Keep the render-time reset** at `useCommands.ts:28-31`. It solves a different
problem — a stale list for one frame on a chat switch — and the subscription fix
does not subsume it.

`session_started` for _this_ chat still triggering `refresh` is intended, and is
the only moment an empty list can fill. Only the foreign-chat wake-up goes away.

## Sketch

**The test has to be fixed with the code, or the guard stays fake.** Adding
`chatId` to the `onChatEvent` call makes the test pass — but it passed before the
fix too, so it never proved anything. The assertion needs a real flush:
`await act(async () => { emit(...) })`, or an assertion after `await waitFor` on
something that must have settled. Without that, the next person to re-broaden the
subscription gets a green suite.

`emit` in that file reaches for `mock.calls.at(-1)`, i.e. `deliver`. That stays
correct after the fix — `chatEvents` still registers exactly one bridge listener
— so the helper needs no change, only the assertions around it.
