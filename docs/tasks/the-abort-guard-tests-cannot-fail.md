# The abort-guard tests cannot fail

## What happens

`useSessionUsage.test.tsx:142-155` ends with
`await expect(Promise.resolve()).resolves.toBeUndefined()` — an assertion about
a promise the test just made, not about the hook. Delete
`!controller.signal.aborted &&` from the hook and the suite stays green.
`useModels.test.tsx:81` is the same line, and its comment says outright that
there is nothing to assert on.

## Why it matters

The guard it claims to cover is what stops a slow read from one workspace
landing in another's attic — `sessionUsage` awaits the subscription figure over
the network, so the window is real. A test that cannot fail is worse than no
test: coverage counts it, and a reader takes it for a promise that was kept.

## A sketch

Render with chat A on a held promise, rerender with chat B, settle A's promise
with a distinctive reading, and assert the hook still reports nothing.
