# `reasonFrom` exists twice

## What happens

`src/core/git.ts:91` exports:

```ts
export function reasonFrom(error: unknown): string
```

— the first line of an error's stderr, capped at 200 characters, so a failure
can be reported without a page of git output.

`src/core/pullRequests.ts:59` defines a private function of the same name doing
the same thing, and that module already imports from `git.ts` two lines above it.

## Why it matters

Small, but it is the kind that goes wrong quietly. The cap and the "first line
only" rule are a decision about what a user is shown when git or `gh` refuses,
and it is now written down in two places that nothing keeps in step. Raising the
cap, or deciding a second line is worth keeping, would fix half the error
messages in the app and leave the other half as they were — with nothing failing
to say so.

## What is already decided

The exported one is the survivor: it is the older of the two, it is covered by
`git.ts`'s own tests, and `remotes.ts` and `worktree.ts` already reach for it.

## A sketch

Delete the private copy, add `reasonFrom` to the existing
`import { countAhead, type GitExec } from './git.js'`. Check the two are
byte-identical first — if the `gh` copy has drifted, that difference is the
interesting part of this task rather than an obstacle to it.
