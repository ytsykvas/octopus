# A branch list cut at a hundred leaves a row unmarked

**Found:** 2026-09-05, narrowed from
`gh-answers-are-capped-and-the-pane-does-not-say-so.md` when that one landed.
The two reads behind the pull request pane now say when they came back full;
this is the third cap, and it has a different surface.

## What happens

`readBranchRequests` asks GitHub for the hundred most recent requests of a
repository — `BRANCH_REQUEST_LIMIT` — and the answer marks every workspace row
at once. A workspace whose request is older than those hundred is simply not in
the answer, so its row draws no mark.

That reads as "no request yet", which is wrong rather than merely incomplete:
the header then offers **Create PR** for a branch that already has one, since
`readyForRequest` wants only changed files or commits ahead beside the missing
mark.

## Why it matters

Less than it looks, and the reason is worth keeping. The offer is as far as it
goes: pressing it opens the pull request tab, which asks about the **branch**
rather than reading the capped list — so the request is there the moment the
pane opens, and nothing wrong is created. What stays silently wrong is the
unmarked row and the button beside it.

It also needs a repository busy enough to have a hundred requests newer than the
one a workspace is still working on, which is not this one.

## What is already decided

**A cap rather than pagination**, for the reason `REPOSITORY_LIMIT` gives: past
this the answer wants a search box rather than a longer page. So the fix is not
a bigger number.

**And not the pane's sentence either.** The two detail reads now say "there may
be older ones this pane is not showing" where the reader is looking at what was
cut. There is no such place here: the casualty is a mark on a row in the
sidebar, and a line under the workspace list saying some marks may be missing
would be an apology on a list that is almost always complete.

## Sketch

The honest shape is a **third state for the mark** — has one, has none, and _we
do not know_ — set on every row when `readBranchRequests` comes back with
exactly its limit. `WorkspaceRow` draws the mark today as present or absent, so
this is a design question about what "unknown" looks like on a row that small,
and what the header offers beside it: `Create PR` is wrong under an unknown
mark, and so is hiding it.

Worth answering when the workspace row is next opened, not before.
