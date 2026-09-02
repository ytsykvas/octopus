# A workspace branch is born tracking the base branch

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`freshBase` returns what `resolveBase` resolved, which for any repository with a
remote is a remote-tracking ref — `origin/main`. That goes straight to
`addWorktree`, which runs `git worktree add -b <branch> <path> origin/main`.

With git's default `branch.autoSetupMerge=true`, starting a branch from a
remote-tracking ref sets an upstream. Verified on git 2.50.1: that command prints
"branch 'octopus/anna' set up to track 'origin/main'", while the same command
from local `main` sets no upstream at all.

So every workspace branch is created with `octopus/anna@{upstream} = origin/main`,
and nothing in the code asked for it.

## Why it matters

Under git's default `push.default=simple`, a plain `git push` in the workspace —
from the built-in terminal, or from the agent, which runs git freely — is refused
with "The upstream branch of your current branch does not match the name of your
current branch", and the **first** of the three things git then suggests is
`git push origin HEAD:main`.

That is not a warning a hurried reader parses as "do not do this". Following it
pushes the workspace's work directly onto the project's base branch, which is the
one outcome the whole worktree-per-task design exists to prevent.

**It does not reproduce on this machine.** `~/.gitconfig` here sets
`push.default = current`, under which a bare `git push` quietly pushes
`octopus/anna` → `origin/octopus/anna` and prints no suggestion at all. The
hazard is for everyone on stock git — which is who `docs/releasing.md` exists
for. Worth knowing before someone tries it, sees nothing, and dismisses this.

Nothing relies on the upstream, so it is only a hazard: the app's own pull-request
path passes `-u origin <branch>` explicitly.

## Evidence

- `src/core/worktree.ts:87-94` — `addWorktree`, the only branch-creating call in
  the codebase; no `--no-track`.
- `src/core/workspaces.ts:169-184` and `:230` — `freshBase` returns
  `resolveBase`'s ref unchanged, straight into `addWorktree`.
- `src/core/remotes.ts:132-151` — only the no-remote branch returns a bare local
  name; the other three all return a remote-tracking ref.
- `src/core/pullRequests.ts:270` and `:314-317` — `push('-u', 'origin', branch)`
  runs before `gh pr create`, so gh never depends on the upstream git set.
- `src/core/workspaces.ts:424,483` — both `deleteBranch` call sites force, so
  `git branch -d`'s upstream-aware merge check is never reached.
- `src/core/worktree.test.ts:169-190` — the tests never assert the upstream, so
  nothing blesses or forbids the current behaviour.
- `docs/core.md:135-161` describes the fetch and the four resolution steps and
  never mentions what the created branch ends up tracking.

## What is already decided

This is not entirely new with the fetch change. `detectBaseBranch`
(`git.ts:235-243`) strips `origin/` and stores the bare name, so a _detected_
base only started producing a tracking branch with `dba5c7d`; a base the user
picked by hand from `listProjectBranches` was already `origin/develop` and
already tracked. `dba5c7d` made it universal rather than introduced it.

`git status` is not lying. "Up to date with 'origin/main'" is literally true of a
branch just cut from that commit. The defect is that git is comparing and
offering to push against the shared base rather than the workspace's own remote
branch — the wrong question, not a wrong answer.

**Keep it to one flag.** Setting `branch.autoSetupMerge=false`, or teaching the
app to `git config` anything, would be the first `git config` write in
`src/core` and would leak into the user's own work in that checkout.

## Sketch

`--no-track` on `worktree.ts:93`. Verified to leave no upstream in both argument
positions. `pullRequests.push` still sets the correct `origin/<branch>` the first
time the branch is pushed.

**A test asserting the absence has to use a repo that has a remote.**
`worktree.test.ts` builds every `addWorktree` case from local `'main'`, which
sets no upstream anyway — a test written against that fixture would pass today
and after the fix, proving nothing. The fixture at `worktree.test.ts:49` does
push to an `origin`, so the test needs `origin/main` as the base and then asserts
`rev-parse --abbrev-ref --symbolic-full-name '<branch>@{upstream}'` rejects.

`renameBranch` (`worktree.ts:216`) uses `git branch -m`, which carries the
upstream across — fixing the creation fixes the rename for free.
