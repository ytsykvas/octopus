# The CLI's own dialogs have nowhere to appear

## What happens

**MCP elicitation is done.** `onElicitation` is declared, `elicitation.ts` reads
the server's schema into fields, and `ElicitationCard` draws them in the log —
see `docs/ui.md`. What is left is the other half.

**`onUserDialog`** — a blocking dialog the CLI asks the host to render, declared
per `dialogKind` (`sdk.d.ts:1543-1578`). The only kind documented today is
`refusal_fallback_prompt`. It requires `supportedDialogKinds`, and the CLI
**fails closed**: a kind not declared there is never sent, and the flow behind it
degrades silently. So we are not ignoring these dialogs — we are not being
offered them, and the user sees the degraded path without ever learning there was
a choice.

## Why it matters

The same class of failure the questions had and the elicitations had: the agent
asks, the interface does not show it, and the conversation goes on as though the
answer had been given. That failure is invisible from inside the app — the only
sign is the agent behaving as if it had been told something.

`refusal_fallback_prompt` is the one with a name: it is what the CLI raises
instead of ending a turn with a refusal, so not declaring it costs the user a
turn every time it would have fired.

## What is already decided

The answer path exists, and now twice over: `ElicitationCard` is the worked
example — its own event, its own pending map, its own channel, abandoned with
the turn like a permission. A dialog kind would be the same shape again.

## Evidence

`sdk.d.ts:1543-1578` (`onUserDialog`, `supportedDialogKinds`), `:7325-7356`
(`UserDialogRequest`, `UserDialogResult`), `:1522-1542` and `:577-605`
(elicitation). `startSession` in `src/core/agent.ts` passes `onElicitation` and
`canUseTool`, and not `onUserDialog`.

## A sketch

Take `refusal_fallback_prompt` first, since it is the only kind that exists:
declare it, render it as a card in the log beside the question card, and answer
`{behavior: 'cancelled'}` for anything unrecognised — which is what the protocol
requires of a host that does not know a kind.

## Read before starting: the payload is undeclared

**2026-09-06.** Checked while the refusal-fallback _line_ was being built, and
this is the reason that landed and this did not.

`UserDialogRequest.payload` is `Record<string, unknown>` and
`UserDialogResult.result` is `unknown`; the SDK says "each `dialogKind` defines
its own payload and result shape; the protocol transports both opaquely", and
**nothing in `sdk.d.ts` declares either shape for `refusal_fallback_prompt`**.
Searched: the string appears only in prose, in `supportedDialogKinds`'
documentation and in the `model_refusal_fallback` message's.

That makes declaring the kind actively worse than not declaring it. The CLI
fails closed today and the flow degrades to the classic refusal error; declare
it and we must answer, and the only answer we can be sure of is `cancelled` —
which produces the same degraded behaviour, having first shown the user a
question we cannot act on.

So this needs the payload shape observed on a live session before anything is
built, and provoking a refusal to obtain it is not something to do casually.

**2026-09-08: the tractable half shipped, and this one still has not.** MCP
elicitation is drawn, answered and recorded. Nothing about the reasoning above
changed — the payload for `refusal_fallback_prompt` is still undeclared, and
declaring the kind without knowing it is still worse than leaving the CLI to
fail closed. What is new is only that the shape to copy now exists in this
repository rather than being described in a note.
