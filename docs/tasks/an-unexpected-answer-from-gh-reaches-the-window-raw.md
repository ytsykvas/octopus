# An unexpected answer from gh reaches the window as a raw zod dump

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`pullRequests.ts` has four gh reads and validates them two different ways.
`listPullRequests` and `github.ts`'s `readPage` use `safeParse` and throw
`GitHubError('listFailed', …)`. `readPullRequestDetail` (twice) and
`readBranchRequests` call `.parse` bare.

Their helpers `asked` and `parsed` only cover a non-zero exit and non-JSON, so a
zero exit with well-formed JSON of the wrong shape reaches zod unguarded. A
`ZodError` is not one of the eight classes `attempt` recognises, so it crosses
IPC with no `code`, `useErrorMessage` hits `default:`, and
`PullRequestPanel.tsx:277` prints the string raw inside a `<p>`.

Built for real by feeding a third `__typename` through the actual code: the pane
renders "Щось пішло не так: [" followed by a multi-line JSON blob carrying
`"note": "No matching discriminator"` and the JSON path into gh's payload. A
diagnostic aimed at whoever wrote the schema, rendered where a sentence for the
user goes.

Not theoretical: `pullRequestShapes.ts:80-85` says the rollup union is
deliberately strict so a third `__typename` "would be a change worth failing on
rather than quietly dropping". The module chooses to fail here, and the failure
has no localised form.

## Why it matters

The house rule is that core throws a code and the renderer localises it; the
English on the error is a log fallback (`docs/PROJECT.md:362`). Here a
Ukrainian-speaking user gets a JSON diagnostic in the one pane that is supposed
to explain GitHub.

The sibling read in the same file already has `errors.listFailed` for exactly
this case, so the pane can say two different things about the same class of
failure depending on which of the two calls tripped.

The branch-list half degrades differently but no better: `useBranchRequests` only
writes on `result.ok`, so the map keeps its last successful read and retries on
the 60s timer — rows show nothing only on the first read after a project is
opened or switched. The end state is the same: a branch with a request looks like
a branch without one, so the header offers Create PR for a request that exists.

## Evidence

- `src/core/pullRequests.ts:491,495,527` — the three bare `.parse` calls.
- `src/core/pullRequests.ts:551-562` — `asked` and `parsed`, the only two
  failures given a code.
- `src/core/pullRequests.ts:187-190` and `src/core/github.ts:209-212` — the
  sibling `safeParse` + coded throw for the identical class of failure.
- `src/main/result.ts:40-48,61` — the eight recognised classes and the uncoded
  fallthrough; `src/core/persist.ts:35-37` — `describeError` returns
  `error.message`, which for a `ZodError` is the serialised issue array.
- `src/renderer/src/hooks/useErrorMessage.ts:130-131`;
  `src/renderer/src/components/pr/PullRequestPanel.tsx:277`.
- `src/core/pullRequests.test.ts:700-707` — "tells an unreadable answer from an
  unexpected one" asserts `code: 'listFailed'` for the unreadable half and only
  `rejects.toBeDefined()` for the unexpected one. The name asserts a distinction
  the code does not make.
- `src/core/pullRequests.test.ts:710-715` and `:767-771` — both cover only
  non-JSON, so neither the `:495` nor the `:527` parse has a wrong-shape test.

## What is already decided

**The message already exists and is already localised.** `en.ts:1017` /
`uk.ts:857` `errors.listFailed` reads "GitHub returned something unexpected." —
exactly this case. No new i18n key is needed.

**Do not soften the schema.** `pullRequestShapes.ts:74-85` argues deliberately for
a strict `__typename` discriminator, and `RollupSchema` is shared by both reads.
Swallowing the parse failure into `[]` would turn a loud failure into a silently
green check list, which is worse than the blob. Keep the throw, give it a code.

**Leave `src/main/ipc.ts`'s bare `.parse` calls alone** (`:512, 522, 528,
537-538, 544, 556`). Those guard against a buggy or compromised renderer
(`docs/ipc.md:210-216`); the condition is a bug in our own code rather than
something a user can provoke, and `ipc.test.ts:1423-1432` asserts only
`{ ok: false }` for them on purpose.

## Sketch

Route the three reads through one helper — `safeParse`, and on failure
`throw new GitHubError('listFailed', {}, …)` — the way the two older ones already
do.

Then tighten `pullRequests.test.ts:707` from `rejects.toBeDefined()` to
`rejects.toMatchObject({ code: 'listFailed' })`, and add the missing wrong-shape
cases for the threads read and for `readBranchRequests`.
