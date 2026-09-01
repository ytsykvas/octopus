# The account says more than we read

The `/usage` response carries a `rate_limits.limits[]` array nothing in the app
touches. Each entry is a window said in a second vocabulary, and it holds two
things the app has nowhere else:

```json
{
  "kind": "weekly_scoped",
  "group": "weekly",
  "percent": 5,
  "severity": "normal",
  "resets_at": "…",
  "is_active": false,
  "scope": { "model": { "id": null, "display_name": "Fable" }, "surface": null }
}
```

`severity` is the **server's** judgement of how bad a reading is. `is_active`
says which window is the one actually binding right now.

## Why it matters

The app recomputes severity itself, from thresholds it chose: `usageLevel` in
`renderer/components/chat/format.ts` turns amber at 60% and red at 80%. Those
are guesses, and the server is not guessing. Two surfaces then disagree with the
account about when a figure is worth worrying over — quietly, and in the
direction of crying wolf.

`is_active` is the more interesting of the two. The sidebar draws every window
at equal weight, and on an account with four of them the reader has to work out
which one will stop the next turn. The server already knows.

## Evidence

In the response measured on 2026-09-01, alongside `rate_limits.five_hour` and
`rate_limits.seven_day` that the app does read. The fixture in
`src/core/usage.test.ts` carries it — `looseObject` lets it through the parse
and `toUsageReport` drops it.

## What is already decided

The thresholds stay where they are until there is something better, and this is
that something. What is not decided is what a server severity should look like
when it disagrees with ours, or whether the binding window should be marked or
moved to the top.

## A sketch

The field is undeclared by the SDK's own type, which is the reason to be careful
rather than the reason not to: read it through `looseObject` as everything else
here is, keep our thresholds as the fallback, and prefer the server's word when
it sends one.
