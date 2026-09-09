# A checkout in the workspace terminal desynchronises everything anchored on its branch

## What happens

A workspace stores a branch name, and the app treats that record as the truth.
`service.readWorkspaceChanges` passes `workspace.branch` into the diff read, and
`readPullRequest` takes the same name from the same record.

Everything _else_ in those reads is anchored on `HEAD`: `mergeBase(baseBranch,
HEAD)`, all four listings against that base, and `countAhead(remoteCommit,
'HEAD')` in `publish.ts`. Nothing reconciles the two — `currentBranch`
(`src/core/git.ts:191`) is called only by `detectBaseBranch`.

The workspace terminal is a shipped tab, and `git checkout` is one command in it.

## Why it matters

Measured against a real repository. Workspace branch `work` is pushed; in the
workspace's own terminal the reader runs `git checkout -b side main` and commits.
`readWorkspaceDiff` then reports the file from `side`, classified against
`work`'s copy on the remote, with one commit to push. The strip offers **Push**;
`pushBranch('work')` pushes `work`, which is already up to date, so the call
succeeds, the pane re-reads, and the strip still says one commit is not pushed.

The button reports no error and never changes the number, however many times it
is pressed. Nothing the reader is looking at is ever sent — which is the worst
shape a control can have.

## What is already decided

- **This is not new.** `readPullRequest` has had the same split since it was
  written: `ahead` is measured to the stored branch and everything else to HEAD.
  The publish read inherited it rather than introducing it.
- **The record is not wrong to exist.** The branch name is what `worktree add`
  created and what a pull request is opened from; it is the _only_ answer for a
  detached HEAD, and `pushBranch` pushing the workspace's own branch rather than
  whatever HEAD wandered onto is arguably right.

## A sketch

Read `currentBranch(exec)` once per diff read and compare. Where it does not
match the record — including a detached HEAD — say nothing about the remote:
`remoteCommit` null and the strip suppressed, the state `publish.ts` already
handles as ordinary. The one extra `rev-parse` costs nothing beside the five
reads already there.

The larger question this opens, and the reason it is a note rather than a fix:
whether a workspace whose HEAD has moved off its branch should be reported
anywhere else in the app — the list's changed-file count, the request pane and
`revert` all read the same worktree without asking.
