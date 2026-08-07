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

3. **Branch.** Check with `git branch --show-current`. Never commit straight
   to `main` (§11.3). If you are on it, create a branch with a meaningful name
   and tell the user.

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

5. **Report.** Tell the user in plain Ukrainian what was recorded. Do not
   recite the diff.

## Do not

- Push unless the user asked.
- Open a PR without an explicit request.
- Pass `--no-verify`.
- Commit `.env`, keys or tokens. If you spot one in the diff, stop and warn.

## If a description was supplied

Use it as the basis for the commit subject, reshaped to the convention. Write
the body yourself from the actual diff.
