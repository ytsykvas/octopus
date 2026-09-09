# A retracted partial is left standing above its replacement

**Found:** 2026-09-06, split off from
`a-model-swapped-by-a-refusal-goes-unmentioned.md` when that one landed. The
line saying which model took the turn is drawn now; this is the second finding
inside the same message.

## What happens

`SDKModelRefusalFallbackMessage` carries `retracted_message_uuids`: the wire
uuids of the messages the fallback **retracted** — the refused partial as the
consumer received it, plus any tombstoned tool results
(`sdk.d.ts:4256`). The SDK is explicit about what a consumer does with it:

> Emitted AFTER the retraction, so this is a resolution-time eviction signal:
> remove these messages from transcript state on receipt. Eviction is idempotent
> — unknown or already-removed uuids are a no-op.

Nothing here evicts anything. So a refused half-answer, and any tool results
that went with it, stay in the log above the fallback model's answer to the same
turn — the conversation shows the work twice, once abandoned and once done, with
only the new line between them saying why.

The same message also carries `refused_user_message_uuid`, the rewind target for
edit-and-retry (`sdk.d.ts:4260`). Nothing uses that either, and it is a
different feature rather than a bug.

**Two things the SDK has clarified since this was written**, both of which change
the shape of the fix:

- `SDKAssistantMessage.supersedes?: UUID[]` (`sdk.d.ts:3007`) is a **second**
  eviction signal, and a cheaper entry point than the notice: it arrives on the
  replacement message rather than at end of turn, so the event being mapped is
  right there. The SDK calls it idempotent with the end-of-turn notice.
- The retraction list carries _"one uuid per normalized SDK message; multi-block
  messages carry per-block derived uuids"_, and the derivation is not documented.
  A single assistant message that maps to `text` plus `tool_use` gives us one
  `message.uuid` while the retraction may name two derived ones — so **carrying
  `message.uuid` verbatim is not sufficient**, which the sketch below assumes it
  is. That is the unknown to settle first.

## Why it matters

Less than the missing line did, and the reason is worth keeping: the log is now
_explained_ rather than merely odd. The remaining cost is a transcript that
disagrees with what the agent holds — the CLI has evicted those messages from
its own state, and octopus has not.

That matters most on **resume**. The transcript is what a reopened conversation
is drawn from, so the abandoned partial outlives the session that produced it,
while the agent resuming from its own session id knows nothing about it.

## What is already decided

**Nothing is deleted from the transcript file.** It is append-only and never
trimmed (`forTranscript`'s header says so), and that is load-bearing: the file
is the record. Whatever this becomes marks entries rather than removing them.

## Evidence

- `src/core/agent.ts` — the `model_refusal_fallback` arm reads five fields and
  not this one.
- `src/core/transcript.ts` — entries are appended and read back in order;
  nothing addresses one by a wire uuid, and `AgentEvent` carries no uuid at all.
  That is the real obstacle: **the events we store cannot be named** by what
  this list names.

## Sketch

Carry the SDK's per-message uuid on the events that have one — `text`,
`tool_use`, `tool_result` — so a retraction has something to point at. Then
either drop retracted entries at read time, or draw them struck through, which
is the more honest of the two and matches "the file is the record".

Worth doing when the transcript is next opened, and not before: it costs a field
on every event of a conversation to serve a message that has never been observed
in this repository.
