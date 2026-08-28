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

3. **Branch.** `main` is protected: it refuses a direct push, so the work
   needs a branch before it can be committed anywhere useful.

   ```bash
   git checkout -b fix/short-description
   ```

   Name it for the change, not for the session. See the Git section of
   `CLAUDE.md`.

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

5. **Report.** Tell the user in plain Ukrainian what was recorded, and say the
   branch is waiting to be pushed and opened. Do not recite the diff.

## Do not

- Push or open a pull request unless the user asked. `origin` is public, so a
  push is published: mirrored and indexed within minutes, and not retractable
  by a later commit.
- Merge your own pull request unless the user asked. Green CI means it is
  ready, not that it was wanted.
- Pass `--no-verify`.
- Commit `.env`, keys or tokens. If you spot one in the diff, stop and warn.

## If a description was supplied

Use it as the basis for the commit subject, reshaped to the convention. Write
the body yourself from the actual diff.
