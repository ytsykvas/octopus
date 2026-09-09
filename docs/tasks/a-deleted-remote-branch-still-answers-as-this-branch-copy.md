# A branch deleted on the server still answers as this branch's copy

## What happens

`PullRequestView` carries two answers to "is this branch on the remote", from
two different sources:

- `pushed`, from a live `git ls-remote --heads origin <branch>`
  (`src/core/pullRequests.ts`), whose own docblock says why it is live: _"a
  branch pushed from another machine is on the remote and absent from this
  clone's refs"_;
- `unpushedCommits`, from `countUnpushed` in `src/core/publish.ts`, which reads
  only this clone's cached refs.

octopus fetches with a plain `git fetch origin` (`src/core/remotes.ts`) — no
`--prune` — so a ref outlives the branch it tracked.

## Why it matters

Reproduced against a real repository and a bare remote. Branch `work` is pushed;
the head branch is then deleted on the server, which is what GitHub does after a
merge when _automatically delete head branches_ is on.

`ls-remote` now answers empty, so `pushed` is false and the create form offers
"this will push the branch". `remoteCopy` resolves the surviving ref, so
`remoteCommit` is non-null, `unpushedCommits` is 0, every file is stamped
`pushed`, and the Changes strip says **"Everything here is on GitHub."** about a
branch that is not on GitHub at all.

The opposite skew reproduces too: a branch pushed from another clone has no
local tracking ref, `countUnpushed` answers null, the count falls back to
`ahead`, and the pane says commits are missing from a branch the same object
records as pushed. One view object contradicting itself is worse than either
answer alone, because nothing on screen says which half to believe.

## What is already decided

- **The ancestor guard does not cover this.** `trackingCopy` refuses a ref the
  branch's fork point is not an ancestor of, which catches a ref left by an
  _earlier workspace of the same name_. A branch deleted after its own merge
  leaves a ref that passes that test, because it is genuinely this branch's.
- **Fetching inside the diff read is out.** `diff.ts` promises that read writes
  nothing, and refs are writes.

## A sketch

Two candidates, and the choice is the interesting part:

- `git fetch --prune origin` where the app already fetches
  (`src/core/remotes.ts`) — one word, and it fixes the diff pane too, but it
  deletes refs on a schedule nobody asked for and would need saying out loud.
- Pass the live `pushed` answer `readPullRequest` already has into the unpushed
  count, and report "nothing sent yet" whenever `ls-remote` says the remote has
  no such branch. That fixes the pull request pane and leaves the Changes tab,
  which has no `gh` and no network, still trusting the ref.
