# A refusal with no fallback writes no line at all

## What happens

The SDK declares two shapes for a model refusing to answer:

- `SDKModelRefusalFallbackMessage` — it refused and the CLI retried on another
  model. octopus reads this one (`src/core/agent.ts`, the
  `model_refusal_fallback` arm) and draws a line saying what happened.
- `SDKModelRefusalNoFallbackMessage` (`sdk.d.ts:4271`, subtype
  `model_refusal_no_fallback`) — it refused and **nothing was retried**.

Grepping `src/` for the second finds nothing. It therefore lands in the
`default: return []` arm at `src/core/agent.ts:748`, produces no event, and the
conversation shows nothing at all.

## Why it matters

This is the worse of the two cases wearing the quieter symptom. In the fallback
case the reader at least gets an answer, from a different model, with a line
saying so. Here they get silence: the turn ends, nothing appears, and the log
gives no reason. The reader is left deciding whether the agent is still thinking,
whether the app dropped something, or whether they should ask again.

`docs/core.md:246` states outright that the fallback line exists to end exactly
that class of silence. It ends it for one of the two subtypes.

## What is already decided

- **The event shape is settled.** `model_refusal_fallback` in
  `src/core/events.ts` carries `originalModel`, `fallbackModel`, `scope`,
  `category` and `explanation`. The no-fallback message carries the same
  description of _why_, minus a model to name — so this is a variant of an event
  that exists, not a new kind of thing.
- **The renderer has somewhere to put it.** `RefusalFallbackRow` in `ChatLog.tsx`
  draws the existing one.

## A sketch

A second arm beside the first, and a nullable `fallbackModel` on the existing
event rather than a second event type — the two differ in one field and the row
already has to say which model answered.

Watch the field is optional with a default: this rides the transcript, which is
read back on every launch, and `CLAUDE.md` records what two fields added without
one did to `state.json`.

The test is a hand-built SDK message, because this has never been seen in this
repository — so reverting the guard verifies the fixture rather than the wire.
That is worth saying in the test itself.
