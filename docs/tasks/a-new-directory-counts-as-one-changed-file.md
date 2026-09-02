# A new directory counts as one changed file

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`changedFiles` runs `git status --porcelain` and returns one entry per output
line; `changeCount` takes its `.length` and the workspace row draws it as
"{{count}} files".

`git status --porcelain` defaults to `-unormal`, which collapses the shallowest
untracked directory into a single `?? dir/` line. Reproduced on git 2.50.1: five
files created under a new `src/components/widget/` (with `src/` already tracked)
give exactly one porcelain line, `?? src/components/`.

So the row reads "1 file" for five files' worth of work, and an agent scaffolding
a directory is the ordinary case.

## Why it matters

The count is what tells someone at a glance which of eight parallel workspaces
has done work. Under-reporting it by an order of magnitude defeats the purpose it
was added for.

Nothing else breaks: `hasUncommittedChanges`, the `bg-accent` dot and the
pull-request gate all test `> 0`, and collapsing never turns a non-empty status
into an empty one. The damage is confined to the number — but the number is the
point.

## Evidence

- `src/core/worktree.ts:226-229` — `exec(['status', '--porcelain'])` split on
  newlines. No `-uall` and no `-c status.showUntrackedFiles=all` anywhere in the
  repository.
- `src/core/git.ts:123-141` — `gitIn` passes argv straight through, so no config
  is injected on the way to git. Contrast `RAW_PATHS` at `src/core/diff.ts:177`,
  where the project does prepend `-c` when it needs to.
- `src/core/workspaces.ts:574` and `:598-603` — the `.length`, into
  `WorkspaceCounts`.
- `src/renderer/src/components/WorkspaceRow.tsx:90-93` with `en.ts:78-81`.
- `src/core/worktree.test.ts:322-346`, `workspaces.test.ts:1009-1019`,
  `service.test.ts:397-408` — **every** test of the count writes loose files at
  the worktree root, so no test reaches a directory. That is why 100% coverage
  stayed green over this.

## What is already decided

**The row and the diff pane are not the same question asked twice**, so do not
aim a fix at making the two numbers agree. The row's number is uncommitted work
only; the pane's is everything since the merge base — committed, staged, unstaged
and untracked. They are meant to differ, and `workspaces.test.ts:1022-1035`
documents that deliberately: a workspace that has committed everything reads
`changedFiles: 0` on the row and shows a full diff in the pane.

The defect is self-contained: the row undercounts **its own** metric.

**Renames are already consistent** — the pane's `DIFF_FLAGS` include
`--find-renames` and porcelain reports a rename as one line, so both sides count
a rename once. Do not "fix" them.

## Sketch

`git status --porcelain -uall`, or count untracked work with
`ls-files --others --exclude-standard` so both paths derive from one command.

Adding `-uall` inside `changedFiles` also changes `hasUncommittedChanges`, used
by `workspaces.ts:461` and `pullRequests.ts:132` and `:349`. Their answers cannot
change, but their cost can: `-uall` walks every untracked directory instead of
stopping at its top. `.gitignore` still applies in both modes, so the usual
`node_modules` case is unaffected; a repository with a large _unignored_
untracked tree is not. If that matters, keep the boolean on the cheap path and
give the count its own command.

The docstring at `worktree.ts:220-225` calls the return value "Paths reported by
`git status --porcelain`". They are not paths — they are status lines, and a
rename arrives as `R  old -> new`. Harmless while only `.length` is consumed; the
moment someone parses paths out of them they need `-z` and git's quoting, and
`diff.ts:177` already solved that.

One case closes the test gap: several files under a _new subdirectory_ in
`describe('changedFiles')`. That shape is the only one the current suite never
builds.
