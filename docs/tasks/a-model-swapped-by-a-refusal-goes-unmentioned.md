# A model swapped by a refusal goes unmentioned

## What happens

When a model refuses a request, the CLI can fall back to another one and carry
on. The SDK announces it — `SDKModelRefusalFallbackMessage`, with
`original_model`, `fallback_model`, a `scope` and a `direction`
(`sdk.d.ts:4233`). `mapMessage` drops it into the `default` arm of the `system`
subtype switch (`agent.ts:542-543`).

The composer's model chip will show the new model, since it names whatever the
session reports and that reading is current (`Composer.tsx:249-260`). What is
missing is the fact that a swap happened, and why: the reader sees the model
change on its own, mid-conversation, with nothing in the log accounting for it.

## Why it matters

The turn that triggered it may read as a normal turn with an odd answer. A model
changing itself is exactly the kind of thing an interface built around
transparency (§4) should say out loud — and the one case where the change is
neither the user's nor the agent's decision.

## What is already decided

Deliberately left out of the work that made `/model` visible in the chip. A
refusal fallback is not a choice, so writing it into `chat.model` would pin a
fallback onto the next session; and the display side needs no work, since the
chip already names what is running. What is missing is only the line in the log.

## Evidence

`sdk.d.ts:4233` (`SDKModelRefusalFallbackMessage`) and its no-fallback sibling
at `:4269`. `scope: 'session'` means the swap outlives the turn;
`scope: 'local'` means only a subagent, a side question or a background fork
fell back and the session model is unchanged (`:4239-4241`) — there the chip
does not move, so the two cases do not want the same line. `direction` still
types as `'retry' | 'revert' | 'sticky'`, but only `retry` is emitted: the
other two are kept for consumer compatibility (`:4231`), so there is one shape
to draw and not three.

The same message carries `api_refusal_category` and `api_refusal_explanation` —
the "why" is on the wire already, though the explanation is prose to display and
never to parse — as well as `refused_user_message_uuid`, the rewind target for
edit-and-retry, and `retracted_message_uuids`, which tells the consumer to drop
the refused partial and its tombstoned tool results from the log (`:4245-4260`).
Nothing here evicts anything, so that partial would be left standing above the
fallback's answer. That is a second finding inside the same message and wants a
note of its own when this one is picked up.

## A sketch

An `AgentEvent` variant carrying both names and the scope, drawn in the
`TurnFooter` register like the reset line. Worth watching one happen first — the
message has never been seen in this repository.
