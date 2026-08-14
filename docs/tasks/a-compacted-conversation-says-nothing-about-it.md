# A compacted conversation says nothing about it

## What happens

When the context window fills, the agent compacts the conversation by itself:
the older exchanges are replaced by a summary, and the SDK announces it with a
`system` message of subtype `compact_boundary`, carrying whether the compaction
was manual or automatic and the token counts either side of it.

`mapMessage` drops it — `agent.ts:405` handles `init` and `commands_changed` and
returns nothing for every other subtype — so the log shows an unbroken
conversation while the agent's memory of its first half is a paragraph.

## Why it matters

The reader has no way to tell a compacted conversation from an intact one, and
the two behave differently: asking the agent to "do what we agreed earlier"
works in one and fails in the other. The failure looks like the agent ignoring
an instruction rather than like a summary having replaced the detail.

`/clear` already draws a line for exactly this reason — see `ResetRow` in
`ChatLog.tsx` — and compaction is the same event with the memory partly kept
rather than wholly discarded. Automatic compaction is the case that matters:
nobody asked for it, so nothing else on screen accounts for it.

## What is already decided

The event variant and the row were designed alongside the slash-command work and
deliberately left out of it: the CLI prints its own text when `/compact` is
typed, so the visible gap is the automatic case, which is about the context
window rather than about commands. A commit that did both could be reviewed as
neither.

The context reading in the composer's attic now offers `/compact` as well, so
the manual case is a click rather than a command someone has to know — which
makes it far more common without moving the gap this task describes, since the
CLI still narrates the one it was asked for. The automatic case is still the
silent one.

## Evidence

Probed against a live session: `/compact` on a conversation too short to compact
answered with `system/status` (`compacting`, then `null`) and an assistant
message reading "Not enough messages to compact."

A real one was reached later, on `octopus/leslie` with CLI 2.1.224, and the
metadata arrives in full — under camelCase names rather than the snake_case the
SDK's prose uses, and with three fields the types do not mention:

```json
"subtype": "compact_boundary",
"content": "Conversation compacted",
"compactMetadata": {
  "trigger": "manual",
  "preTokens": 73984,
  "postTokens": 16023,
  "cumulativeDroppedTokens": 57961,
  "durationMs": 65548,
  "preCompactDiscoveredTools": ["ExitPlanMode"],
  "preservedMessages": { "anchorUuid": "…", "uuids": ["…"] }
}
```

So the sketch below can be built: `trigger`, `preTokens` and `postTokens` are
all there, and `postTokens` is the whole context rather than the summary alone —
`preTokens` matched the last request's prompt of 73,572 to within a rounding of
the system prompt.

Two things that turn is worth knowing for. It took **66 seconds and a dollar**,
which is long enough that the composer needs to look busy for it — it did, the
turn being an ordinary one. And its `result` reported `inputTokens: 0`, so the
summarising call's tokens are attributed to nothing: the footer read
`65.9s · 0 tokens` under a turn that was neither.

## A sketch

An `AgentEvent` variant carrying `trigger`, `preTokens` and `postTokens`
(the last two nullable), mapped in the `system` switch, drawn in the
`TurnFooter` register beside `ResetRow`. Verify the metadata against a live
compaction first — see the note above.
