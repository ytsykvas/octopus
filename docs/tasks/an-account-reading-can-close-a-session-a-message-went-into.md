# A background account reading can close a session a message was just sent into

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`askAccount` takes its probe branch only when the whole `sessions` map is empty
— before the first message of the run, or after every chat has been closed. It
calls `startFor` on `state.chats.at(-1)`, and `startFor` registers that session
in the service-wide map. For the ~720-850ms of a cold read, the probe **is** the
chat's session for every other caller.

If `sendToChat` for that chat runs inside that window it appends the user's
message to the transcript, finds the probe, and then one of two things:

- **the close lands after `session.send(text)`** — the message reaches the SDK,
  `probe.close()` kills the child process mid-turn, and (confirmed against the
  bundled SDK) `close()` ends the message stream with `inputStream.done()`, not
  `.error()`, so the read loop falls out silently. No `result`, no `error`, and
  the chat has just been set to `running`. The turn vanishes.
- **the close lands during the awaited `setPermissionMode` / `setEffort`** —
  those control requests reject against a closed query and the user gets a
  visible send failure with the message already in the log. Bad, but not silent.

## Why it matters

The turn vanishes without a word: the message is in the log, the tab says busy,
and no `result` or `error` will ever arrive, because the process answering it was
killed. It costs the user a prompt and leaves the workspace list showing work
that is not happening.

The window is narrow — it needs the map to be empty, so in practice the first
send of a run, which is also the send most likely to coincide with the mount or
focus refresh. After the first message anywhere in the app the map is never empty
again.

## Evidence

- `src/core/service.ts:1175-1199` — the probe branch, `startFor` at `:1185`, and
  the unconditional `sessions.delete` / `probe.close()` in the `finally` at
  `:1190-1192`, with no check that the entry is still an unused probe.
- `src/core/service.ts:2001` — `sessions.set(chat.id, session)` inside
  `startFor`: the probe is indistinguishable from the chat's own session.
- `src/core/service.ts:3068-3186` — `sendToChat`: the message on disk at `:3075`,
  `sessions.get` at `:3148`, two awaited control requests at `:3149-3151`, `send`
  at `:3184`, `running` at `:3186`.
- `src/core/agent.ts:505-515` and `:420-441` — `close()` kills the child mid-turn
  and the read loop ends cleanly, emitting neither `error` nor `result`.
- `src/renderer/src/hooks/useSubscriptionUsage.ts:100-124` — refreshes on mount,
  on `focus`, on `visibilitychange`, plus a timer while visible.
- Nothing serialises `chats:send` against the reading: `ipc.ts:601` hands
  straight to `service.sendToChat`, and `reading` only coalesces readers.

## What is already decided

**The tab is recoverable**, contrary to how this first looked. `interruptChat`
(`service.ts:3189-3204`) sets the chat to `idle` whether or not it finds a
session — its comment says so — and `settleStatuses` (`store.ts:298`) resets
`running` on the next launch. What is lost is the turn, not the tab.

**"Just don't register the probe in `sessions`" is not a complete fix.**
`startFor` is not a passive reader: it wires `handleEvent` for that chat, so a
`session_started` from the probe is committed onto the chat's `sessionId`, and it
fires the models and commands background writes. A probe kept out of the map
would let a concurrent `sendToChat` spawn a **second** CLI against the same chat
record and worktree, both writing the chat's session id.

## Sketch

Make the close conditional on the probe still being unused: only
`sessions.delete`/`close` when the map entry is still this probe and nothing has
been sent into it; otherwise let it stay as the chat's own session.

**The transcript-loss version of the same race is the reason not to stop there.**
The probe's `finally` skips every piece of teardown `closeOneChat` does
(`service.ts:1705-1723`) — `abandonPermissions`, `abandonEdits`,
`clearRequests.delete`, `clearedTurns.delete`. If the message sent into the probe
is `/clear`, `sendToChat` adds the chat to `clearRequests` at `:3110`; the killed
probe never returns the `conversation_reset` that would consume it, so the flag
survives for the rest of the run. The next reset the chat sees — the CLI sends
one when a plan is approved — is then read by `answerReset` (`:1431-1436`) as the
user's clear, and `discard(chat)` removes the transcript. So the borrowed case
must also leave the chat's `clearRequests` and permission state alone.

Note `state.chats.at(-1)` is the most recently **created** chat record
(`openChat` appends), not the one last worked in.
