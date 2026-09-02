# A tool result nothing can ever draw is kept in full

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`fromUser` puts the whole text of every tool result into a `tool_result` event —
`describeToolResult` joins every text block under no bound. `isEphemeral` does
not name that variant, so `handleEvent` records it as one JSONL line carrying the
entire output.

The renderer then throws the content away for every successful call, and the
unreachability is total: `AgentRow` returns null when `event.ok`, and the opened
fold does not show it either, because `ToolRun` renders a row only for `tool_use`
entries. `event.content` is read in exactly two places, both inside the
`!event.ok` branch.

So a `Read` of a 3000-line file, a `Bash` printing a build log, a `Grep` across
the repository: each written to `~/.octopus/chats/<id>.jsonl` in full, parsed
back by `readTranscript`, shipped over IPC and held in the renderer's `entries`
array — to be dropped at render time.

## Why it matters

The transcript is append-only and never trimmed, and nothing bounds this field.
The cost of opening a conversation therefore grows with everything the agent has
ever **read**, not with what it said — the larger number by a wide margin. Every
open re-reads and re-validates the whole file, and the window keeps it resident.

Nothing observable fails today, which is what makes it an improvement rather than
a bug.

## Evidence

- `src/core/agent.ts:671-679` and `:691-699` — `content: describeToolResult(...)`,
  joined with no bound.
- `src/core/events.ts:224-231` — `isEphemeral` names only `text_delta`,
  `thinking_delta`, `rate_limit` and `commands_changed`.
- `src/core/service.ts:1268-1279` — `record` appends the entry verbatim, with no
  filtering of any field.
- `src/core/service.ts:1521-1530` — the only other core consumer reads
  `toolUseId` and `ok`, never `content`.
- `src/renderer/src/components/chat/ChatLog.tsx:386-391` — `ToolRun` renders a
  row only for `tool_use`, so the field is unreachable on every path.
- `src/renderer/src/components/chat/ChatLog.test.tsx:431-444` — "shows a failed
  tool result and stays quiet about a successful one", under the comment "pasting
  that into the chat would bury the conversation in the codebase".
- Nothing replays the transcript back to the SDK, so the text is not load-bearing
  for resume.

## What is already decided

**The renderer's silence is deliberate and tested**, so the fix belongs at the
recording end, not the drawing end.

The bound on `ChatMessageSchema` (`chats.ts:583-587`) is not a precedent to
follow: it is justified as an input guard on something that becomes a prompt, not
as a storage policy. Nothing in the codebase bounds anything on the transcript
side — which is the actual point.

**Dropping the entry entirely forecloses a direction the UI is already pointed
at.** `ToolRun` opens into the working-out, and showing a call's output inside
that fold is the natural next feature, at which point the content becomes
load-bearing. Bounding the field on the way in — keep a head of N characters, note
that it was cut — is the fix that does not spend that option.

## Sketch

The distinction `isEphemeral` already draws between what is shown and what is
kept is the natural home.

`src/core/transcript.test.ts:155-190` must change with it: its "every kind of
event survives being written and read" table includes a `tool_result` with
`ok: true, content: 'done'` and asserts an exact round trip. That table is
already a partial enumeration — it omits `conversation_reset`,
`question_answered` and `usage` — so its inclusion of this variant is not
evidence that keeping the content was ever weighed.

`drawsNothing` (`toolRuns.ts:138-148`) must stay whatever is chosen, because the
live stream from `onChatEvent` still delivers the event whether or not it is
written down.

Worth recording the decision in `docs/data.md`'s "What is deliberately not
stored" section (`:373` onward), which is where a reader would look for it and
currently finds nothing.
