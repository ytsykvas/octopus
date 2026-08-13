# A model swapped by a refusal goes unmentioned

## What happens

When a model refuses a request, the CLI can fall back to another one and carry
on. The SDK announces it — `SDKModelRefusalFallbackMessage`, with
`original_model`, `fallback_model`, a `scope` and a `direction`
(`sdk.d.ts:4233`). `mapMessage` drops it into its `default` arm.

The footer will show the new model, since it names whatever the session reports
and that reading is current. What is missing is the fact that a swap happened,
and why: the reader sees the model change on its own, mid-conversation, with
nothing in the log accounting for it.

## Why it matters

The turn that triggered it may read as a normal turn with an odd answer. A model
changing itself is exactly the kind of thing an interface built around
transparency (§4) should say out loud — and the one case where the change is
neither the user's nor the agent's decision.

## What is already decided

Deliberately left out of the work that made `/model` visible in the footer. A
refusal fallback is not a choice, so writing it into `chat.model` would pin a
fallback onto the next session; and the display side needs no work, since the
footer already names what is running. What is missing is only the line in the
log.

## Evidence

`sdk.d.ts:4233` (`SDKModelRefusalFallbackMessage`) and its no-fallback sibling
at `:4266`. `scope: 'session'` means the swap outlives the turn;
`direction: 'retry' | 'revert' | 'sticky'` says some of them undo themselves,
which is why "just record it" is not obviously right.

## A sketch

An `AgentEvent` variant carrying both names and the direction, drawn in the
`TurnFooter` register like the reset line. Worth watching one happen first — the
message has never been seen in this repository, and the direction field suggests
at least three shapes of it.
