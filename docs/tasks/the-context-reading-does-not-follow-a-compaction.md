# The context reading does not follow a compaction

## What happens

`/compact` succeeds — the conversation is summarised and most of the window
freed — and the `Context N%` reading in the composer's attic goes on showing the
figure from before it. It corrects itself on the next message.

Measured against a live session: 74k tokens before, 16k after, and the reading
stayed where it was.

## Why it matters

The reading is the reason the command was run. Someone who compacts to make room
and sees the same percentage afterwards has been told the thing they just did
did not work — and the honest next move, running it again, costs another minute
and another dollar for nothing.

It is also the worse half of the pair: the log saying nothing about a compaction
(see [a-compacted-conversation-says-nothing-about-it.md](a-compacted-conversation-says-nothing-about-it.md))
is an omission, while this is a number that is wrong. Now that the reading opens
a menu offering `/compact`, both are reached far more often than when the
command had to be known and typed.

## Evidence

Measured on `octopus/leslie`, CLI 2.1.224, Sonnet 5 with a 1M window, on
2026-08-14. The session file
(`~/.claude/projects/<workspace>/38aed6ee-….jsonl`) records the compaction:

```json
"subtype": "compact_boundary",
"compactMetadata": {
  "trigger": "manual",
  "preTokens": 73984,
  "postTokens": 16023,
  "cumulativeDroppedTokens": 57961,
  "durationMs": 65548
}
```

74k of a 1M window is 7%; 16k is under 2%. The attic went on reading `Context 7%`.

The pull happened. `useSessionUsage.ts:54-63` refreshes on `session_started` and
on `result`, and the chat's own transcript has both, 358ms after the boundary:

```json
{"event":{"type":"session_started","sessionId":"38aed6ee-…"}}
{"event":{"type":"result","ok":true,"costUsd":1.0005891,"durationMs":65908,
          "inputTokens":0,"outputTokens":0,"terminalReason":null}}
```

So `getContextUsage()` (`agent.ts:200-217`) answered with the pre-compaction
figure when asked after the compaction had finished. The likely reason is the
`result` above: the turn reports **zero** tokens although the summarising call
cost a dollar, so whatever the CLI's context accounting is keyed to had not
moved either — the last request it knows about is the summarisation, whose own
prompt was the full 74k.

Not established: whether a second read a few seconds later would answer
correctly, which decides between "the CLI updates late" and "the CLI only
updates on the next request". Ask twice before choosing a fix.

## What is already decided

**Not a timer.** `useSessionUsage.ts:15-18` rules one out on purpose — each read
is a round trip to the agent — and the answer to a stale figure is another
event, not polling for one.

The event exists and is already being dropped: `mapMessage` returns `[]` for
every `system` subtype it does not know (`agent.ts:489-490`), `compact_boundary`
among them. Mapping it is the same piece of work the log's missing row needs, so
the two should land together rather than mapping the same event twice.

## A sketch

Map `compact_boundary` to an `AgentEvent` carrying `trigger`, `preTokens` and
`postTokens`, and have `useSessionUsage` refresh on it as it does on `result`.

If the CLI turns out to answer with the old figure whenever it is asked before
the next request, the percentage has to come from `postTokens` on the event
rather than from a re-read — in which case the reading stops being purely a
pull, and `SessionUsage` needs to say where its figure came from.
