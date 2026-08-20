# A merged request leaves its workspace behind

## What happens

Merging from the pull request tab re-reads the request, the pane says "merged"
and the mark beside the workspace turns red. Nothing else happens: the worktree,
the branch and the record all stay until somebody removes them by hand.

## Why it matters

§3 draws the lifecycle as `task → workspace → agent works → diff → PR → merge →
archive`, and the last arrow is the one the app does not draw. A merged
workspace looks exactly like a working one in the list, so the list fills with
finished work and the reader has to remember which of eight branches is done.

Removal already knows how to do the whole thing — it asks about uncommitted
work, offers to delete the branch, and runs `archive.sh`
(`src/core/workspaces.ts`). What is missing is anything connecting a merge to it.

## Evidence

- `src/renderer/src/components/pr/PullRequestPanel.tsx` — `merge` re-reads and
  stops there.
- `docs/PROJECT.md` §3 names archiving as the step after merging.

## What is already decided

- Merging never deletes the branch itself: a worktree is checked out on it, so
  git refuses, and the failure would be one the app caused (`mergePullRequest`
  in `src/core/pullRequests.ts` says so).
- Whatever this becomes, it asks first. A merge is somebody else's repository
  changing; removing a directory is this machine's work disappearing, and the
  two should not ride on one press.
