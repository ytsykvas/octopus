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

## Evidence

Probed against a live session: `/compact` on a conversation too short to compact
answered with `system/status` (`compacting`, then `null`) and an assistant
message reading "Not enough messages to compact." A real compaction was not
reached, so the shape of `compact_metadata` in practice — in particular whether
`post_tokens` and `duration_ms` arrive — is still only what the types promise.

## A sketch

An `AgentEvent` variant carrying `trigger`, `preTokens` and `postTokens`
(the last two nullable), mapped in the `system` switch, drawn in the
`TurnFooter` register beside `ResetRow`. Verify the metadata against a live
compaction first — see the note above.
