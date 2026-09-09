# A branch pushed from another clone reads as unpushed

## What happens

`readPullRequest` (`src/core/pullRequests.ts:147`) asks two different sources
whether the branch is on the remote:

- `pushed`, from a live `git ls-remote --heads origin <branch>` (`:223`);
- `unpushedCommits`, from `countUnpushed` (`src/core/publish.ts:194`), which
  reads only this clone's cached refs.

A branch pushed from **another machine** is on the remote and absent from this
clone's refs — `isPushed`'s own docblock at `:216-222` says exactly that, and it
is why the live read exists. So `countUnpushed` finds no copy, answers null, and
the count falls back to `ahead`. The pane then says _"1 commit is not on GitHub
yet."_ about a branch the same object records as pushed.

## Why it matters

Pressing Push runs a `git push` that reports "Everything up-to-date", so the
number never changes however many times it is pressed — the shape a control
should never have. The two halves of one view object disagree, and nothing on
screen says which to believe.

Narrow, but not theoretical: it is the state of any workspace whose branch was
pushed from a second checkout, and of one restored from a machine that had the
work before this one did.

## What is already decided

- **The opposite skew is fixed.** A branch _deleted_ on the server used to read
  as fully pushed, because the tracking ref outlived it. `pullRequests.ts:174`
  now reads `pushed ? (unpushed ?? ahead) : ahead`, so a remote that says it has
  no such branch wins over the cached ref. That is the half of this that could be
  answered locally.
- **`--prune` was considered and refused.** `src/core/remotes.ts:164-165` records
  the decision: _"pruning deletes refs, and a destructive side effect does not
  belong behind a button that says 'new workspace'."_ `remotes.test.ts:222-231`
  pins the exact argv to stop a flag being added. It would not fix this anyway —
  pruning removes refs, and here the ref is missing rather than stale.
- **A local read cannot answer it.** The commits exist on the remote and nowhere
  in this clone. Nothing short of asking the network can count them.

## A sketch

Two shapes, and choosing between them is the work:

- **Fetch the branch when the pane opens.** `ls-remote` is already a round trip
  on that path, so the cost is the objects rather than the latency. But
  `readPullRequest` sits behind `diff.ts`'s promise that the read writes nothing,
  and fetching writes refs — so it would have to move, or the promise would have
  to be narrowed to the modules that still keep it.
- **Say "cannot say" rather than guessing.** `unpushedCommits` becomes
  `number | null` all the way to the pane, which draws no count and no Push
  button while it is null. Honest, cheap, and it costs a third state in
  `PullRequestActions.tsx` plus a string in both locales.

The second is smaller and does not disturb anything. The first is what the reader
actually wants, and is worth doing only if the fetch has somewhere to live.
