---
name: check
description: Full project quality gate — formatting, lint, types, tests with coverage — explaining every failure in plain language and fixing what it finds.
when_to_use: Before a commit, after a batch of changes, or whenever the user asks whether everything is fine or if something broke.
argument-hint: '[fix]'
allowed-tools: Bash(npm run:*), Bash(npx:*), Read, Edit, Glob, Grep
---

# Project check

Run the full quality gate and explain the outcome.

## What to do

1. Run `npm run check`.

2. If everything passes, confirm briefly: how many tests, what coverage.
   Do not reproduce the whole output.

3. If something fails, **explain the cause in plain language**, without jargon,
   and fix it. The user does not know this stack; raw tool output tells them
   nothing.

Replies to the user are written in Ukrainian; everything written into the
repository stays English.

## Reading the failures

The gate has four stages, each failing differently:

| Stage           | What a failure means                                         | Usual fix                          |
| --------------- | ------------------------------------------------------------ | ---------------------------------- |
| `format:check`  | files are not formatted                                      | `npx prettier --write .`           |
| `lint`          | a code-quality rule was broken                               | `npx eslint . --fix`, rest by hand |
| `typecheck`     | types do not line up — a real defect, not a formality        | investigate properly               |
| `test:coverage` | a test failed **or** `src/core/` coverage dropped below 100% | fix the code or add the test       |

**Never lower the coverage threshold to make the gate pass.** The threshold in
`vitest.config.ts` is a safety net, not an obstacle (§11.3 docs/PROJECT.md).
A drop means new untested code in the core — cover it.

**Never disable a lint rule to silence an error.** An exception is possible,
but then explain to the user why the rule does not apply here.

## Argument

With `fix`, repair what is found and report what changed. Without it, show the
problem first and ask before applying a non-obvious fix.

## Finish

One line: whether this can be committed. If not, what is left.
