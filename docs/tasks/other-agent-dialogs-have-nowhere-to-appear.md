# Other agent dialogs have nowhere to appear

## What happens

The agent's questions now have a card (`QuestionCard.tsx`), but that was the
first of several things the agent can put in front of the user, and the rest
still have nowhere to go:

- **`onUserDialog`** — a blocking dialog the CLI asks the host to render,
  declared per `dialogKind` (`sdk.d.ts:1543-1578`). The only kind documented
  today is `refusal_fallback_prompt`. It requires `supportedDialogKinds`, and
  the CLI **fails closed**: a kind not declared there is never sent, and the
  flow behind it degrades silently. So we are not ignoring these dialogs — we
  are not being offered them, and the user sees the degraded path without ever
  learning there was a choice.
- **MCP elicitation** (`onElicitation`, `sdk.d.ts:1300-1306`) — an MCP server
  asking for input, with its own JSON Schema for the form. Without the callback
  the SDK auto-declines. Not reachable today, since nothing configures MCP
  servers, but it becomes reachable the moment something does.

## Why it matters

Both are the same class of failure the questions had: the agent asks, the
interface does not show it, and the conversation goes on as though the answer
had been given. That failure is invisible from inside the app — the only sign is
the agent behaving as if it had been told something.

`refusal_fallback_prompt` is the one with a name: it is what the CLI raises
instead of ending a turn with a refusal, so not declaring it costs the user a
turn every time it would have fired.

## What is already decided

The answer path exists. `PermissionOutcome.updatedInput` and the card in the log
are the shape to copy; the difference is that these two dialogs come through
their own callbacks rather than through `canUseTool`, so they need their own
event and their own way of reaching a window.

## Evidence

`sdk.d.ts:1543-1578` (`onUserDialog`, `supportedDialogKinds`), `:7325-7357`
(`UserDialogRequest`, `UserDialogResult`), `:1300-1306` and `:577-605`
(elicitation). `startSession` in `src/core/agent.ts` passes neither callback.

## A sketch

Take `refusal_fallback_prompt` first, since it is the only kind that exists:
declare it, render it as a card in the log beside the question card, and answer
`{behavior: 'cancelled'}` for anything unrecognised — which is what the protocol
requires of a host that does not know a kind.
