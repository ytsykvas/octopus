# The attic may be paying for a transcript scan every turn

## What happens

`readSubscriptionUsage` (`src/core/agent.ts:247-265`) issues the SDK's
`get_usage` control request and keeps two numbers out of the response —
`five_hour` and `seven_day`. `useSessionUsage.ts:54-63` calls it on every
`session_started` and every `result`, so it runs at the end of every turn in
every open conversation.

That response also carries `behaviors`, which the SDK documents as coming
"from a scan of local transcripts on this machine" (`sdk.d.ts:3421-3423`) —
every session file under `~/.claude/projects`, read and weighted.

**Not established, and it is the whole question:** whether the CLI performs that
scan when the caller ignores the field. If it does, the composer's strip has
been triggering a full-disk scan after every turn to draw two percentages.

## Why it matters

It is invisible if it is real. The reading is awaited inside `sessionUsage`
(`service.ts:2226-2231`) alongside the context read, so a slow scan delays the
strip and nothing else — no error, no spinner, just a figure that updates late.
On a machine with months of transcripts and three conversations open, that is
three scans per turn.

It also decides something about the new usage card. `readUsageReport`
(`agent.ts:267-291`) makes the same call and does read `behaviors`, so if the
scan is conditional the two readers should stay separate as they are, and if it
is not, the cheap one is not cheap and the two should share one call and a
cache.

## Evidence

Both readers, and the SDK's own description of the field:

```
agent.ts:247   readSubscriptionUsage  → keeps fiveHour, sevenDay
agent.ts:267   readUsageReport        → keeps everything, including behaviors
sdk.d.ts:3421  "from a scan of local transcripts on this machine …
                Approximate, excludes other devices and claude.ai"
```

## What is already decided

**Not a timer, and not fewer refreshes.** `useSessionUsage.ts:15-18` rules out
polling on purpose, and the answer to a stale figure is another event rather
than a slower one. If the scan turns out to be real, the fix is on the reading
side — one call feeding both consumers — not on how often the strip updates.

## How to find out

Time it against a live session, from a machine with a real transcript history:

```ts
const start = performance.now()
await conversation.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()
```

A few milliseconds means the scan is lazy and there is nothing here. Hundreds,
growing with the size of `~/.claude/projects`, means it is not.
