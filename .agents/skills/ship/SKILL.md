---
name: ship
description: Finish a change — run the quality gate, review what changed and commit it following the project convention.
when_to_use: When a change is ready to be recorded. Also on phrases like "commit this", "save the changes", "done, let us record it".
argument-hint: '[change description]'
allowed-tools: Bash(npm run:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git branch:*), Read
---

# Recording a change

## Steps

1. **Gate.** Run `npm run check`. If it fails, fix it first — broken code is
   not committed.

2. **Review.** Run `git status` and `git diff`. Make sure nothing unwanted
   slipped in: temporary files, debug `console.log`, commented-out code,
   secrets.

3. **Branch.** Every change reaches `main` through a branch and a pull request,
   so the work needs a branch before it can be committed anywhere useful.

   Inside an Octopus workspace (its worktree sits under `~/.octopus/workspaces/`)
   the branch already exists — the workspace's own, such as `octopus/gwen`.
   Stay on it: the app finds the pull request, the Changes tab and the push
   button by that name, and `git checkout -b` would leave all three empty.

   In a plain checkout, make one:

   ```bash
   git checkout -b fix/short-description
   ```

   Name it for the change, not for the session. See the Git section of
   `AGENTS.md`.

4. **Commit.** Conventional Commits, **in English** like the rest of the
   repository:

   ```
   feat: add worktree manager

   Create, list and remove workspaces via git worktree. The port is derived
   deterministically from the workspace id.
   ```

   Prefixes: `feat:` new capability, `fix:` bug fix, `refactor:` no behaviour
   change, `test:` tests, `docs:` documentation, `chore:` chores (dependencies,
   configs).

   One commit, one logical change. If the diff holds two unrelated things,
   split it.

   Splitting a **file** is the awkward case, because `git add -p` is
   interactive and an agent cannot drive it. Take `git show HEAD:<file>` into a
   scratch copy, apply only this change's edits to it, and stage that with
   `git update-index --cacheinfo 100644,$(git hash-object -w <copy>),<file>`;
   the working tree keeps both changes. Then `git diff --cached --stat` must
   name exactly this change's files, and nothing else, before committing.

5. **Report.** Tell the user in plain Ukrainian what was recorded, and say the
   branch is waiting to be pushed and opened from the app's Pull request tab.
   Do not recite the diff.

## Do not

- Push or open a pull request unless the user asked. Treat a push as published:
  `origin` is private now but has been public, and a public commit is mirrored
  and indexed within minutes and not retractable by a later commit.
- Merge your own pull request unless the user asked. A green gate means it is
  ready, not that it was wanted — and with CI off, the gate is the local one on
  the branch merged with fresh `main`.
- Pass `--no-verify`.
- Commit `.env`, keys or tokens. If you spot one in the diff, stop and warn.

## If a description was supplied

Use it as the basis for the commit subject, reshaped to the convention. Write
the body yourself from the actual diff.
