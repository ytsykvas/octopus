# A workspace standing off its branch says so only in the Changes tab

## What happens

`git checkout` in the workspace's own terminal moves `HEAD` off the branch the
workspace was created on. The Changes tab now notices and says so; nothing else
does.

The sidebar row keeps drawing the stored branch name, and its "ahead" badge comes
from `countAhead(base, workspace.branch)` (`src/core/workspaces.ts:675`) — a count
about `work` while the pane beside it is drawing `side`. The changed-file count
next to it (`workspaces.ts:645`) is about the worktree, so the two numbers in one
row are about two different things.

## Why it matters

Nothing here is false, which is why this is a note rather than a bug: both
readings are honest about what they measure. What is missing is that the row
never says the two have come apart, so a reader looking at the list has no way to
know that the branch named on the row is not the branch the work is going onto.
They find out by opening the Changes tab, or by pressing _Commit and push_ and
being refused.

That refusal is the reason this is worth writing down at all: the app now has a
state it explains in one place and enforces in another, and the list — the thing
that is always on screen — is silent about it.

## What is already decided

- **The reads that were wrong are fixed.** `publish.ts` compares `HEAD` against
  the stored name before anything else and says nothing about GitHub when they
  differ; `commitAndPush` and `createPullRequest` refuse with `headNotOnBranch`.
- **`countAhead(base, branch)` is not being changed.** It answers a question
  about the branch, and the branch is a real thing whatever `HEAD` is doing.
  Re-anchoring it on `HEAD` would make the badge silently mean something else.
- **The name on the row stays the workspace's branch.** It is what the worktree
  was created on and what a pull request would be opened from.

## A sketch

The cheapest honest thing is a mark on the row, the way `RequestMark` already
carries one — the branch name gets a quiet glyph, and its tooltip says the
worktree is standing somewhere else. That needs the fact on `WorkspaceView`,
which means one more read in `countChanges`, which already spawns per workspace.

Worth measuring before writing: `countChanges` runs for every workspace in the
project on every list refresh, and one more `git branch --show-current` each is a
cost the Changes tab does not pay, since it reads one workspace at a time.
