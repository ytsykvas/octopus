# sameModel answers "no" for two names of one model

## What happens

`sameModel` is meant to say whether two names mean the same model. On a live
catalogue it gets the answer wrong for the pair it was written for:

```ts
sameModel('opus[1m]', 'claude-opus-5[1m]', catalogue) // false — should be true
```

The catalogue holds two entries resolving to `claude-opus-5[1m]`: the row called
`default`, first, and the row called `opus[1m]`. `findAgentModel('opus[1m]')`
matches on `value` and answers `opus[1m]`. `findAgentModel('claude-opus-5[1m]')`
finds no exact match, falls to the second pass and answers **`default`**, since
that is the first entry resolving to the name. The two `value`s differ, so
`sameModel` reports two different models.

## Why it matters

It has no production caller today, which is the only reason nothing is broken.
Its docstring names the intended use — telling "the session moved to another
model" from "the session named the same model in full", so the interface does
not announce a change on every session start. A caller written against it would
announce one every time the account default is in play, which is the common
case.

It is also a trap for the next reader: an exported, tested helper reads as
working.

## Evidence

- `src/core/chats.ts` — `sameModel`, and `findAgentModel` above it, whose
  own comment describes exactly this `default` / `opus[1m]` collision.
- `src/core/chats.test.ts` — the `CATALOGUE` fixture is a real one, with both
  rows. The existing tests use `sonnet`, which has no collision, so they pass.
- `defaultAgentModel` in the same file works around the collision by filtering
  the `default` row out before searching. That is the shape of the fix.

## What is already decided

The `default` row cannot simply be dropped from the catalogue: it is what a chat
with no override runs, and the picker draws it.

## A sketch

Two candidates.

1. Compare through `resolvedModel` rather than through the answering row's
   `value`: two names mean one model when the entries they find resolve to the
   same full name, falling back to `value` when neither resolves to anything.
2. Filter `default` out before the lookup, as `defaultAgentModel` does, and give
   the second pass a catalogue with no duplicates in it.

The first is more honest about what the question means; the second reuses a
decision already taken next door. Either needs the collision case in the tests,
which is what is missing now.
