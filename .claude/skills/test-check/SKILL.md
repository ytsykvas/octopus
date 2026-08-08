---
name: test-check
description: Audits the test suite for gaps coverage cannot see — untested code, tests that assert nothing, and tests that model a state the system never produces. Writes the missing ones.
when_to_use: After adding or changing behaviour, when a bug got through despite a green suite, before a release, or on "are the tests enough", "write the missing tests".
argument-hint: '[fix]'
allowed-tools: Bash(npx vitest:*), Bash(npm run:*), Bash(git diff:*), Bash(git status:*), Bash(grep:*), Bash(rg:*), Bash(git worktree:*), Read, Write, Edit, Glob, Grep
---

# Test check

Coverage is at 100% and enforced, so "is it covered" is never the question here.
The question is whether the tests would have caught the bug.

They have not, twice. A workspace whose directory had been deleted reported as
healthy while every line was covered — the test filtered the entry out of the
list itself, modelling a state git never produces. A colour picker did nothing
for a week because `updateProject` listed its fields explicitly and nobody added
the third.

## Start here

```bash
npx vitest run --coverage
```

If anything is below 100%, that is the easy part — write those first, then get
to the work below.

## What to look for

### 1. Tests that model a state the system cannot reach

**This is the one that matters most.** A test that constructs its own input can
assert anything and prove nothing.

Look for a test that builds the awkward case by hand — filtering a list,
hand-writing a parser's input, assembling a record — where the real thing could
have produced it instead. Then go and get the real output:

```bash
git worktree list --porcelain   # after rm -rf on the worktree
git branch --remotes --format='%(refname)'
```

If the tool's real output differs from what the test assumed, you have found a
bug rather than a test problem.

### 2. Assertions that cannot fail

- `expect(result).toBeDefined()` on something that is always defined
- a `toMatchObject({})` with nothing in it
- a rendered component asserted only to "not throw"
- a mock asserted to have been called, where nothing else was possible

For each, ask: **what would have to break for this to go red?** If the answer is
"nothing", the test is decoration.

`not.toThrow()` is not automatically decoration. Where the contract _is_
tolerance — disposing a session twice, resizing one that has ended — it is the
whole assertion, and `src/main/terminals.test.ts` uses it correctly. The
question is whether tolerance is the promise being made.

### 3. Fields and branches added without a test

```bash
git diff --stat HEAD~10..HEAD -- src/
```

For each changed function, list its parameters, its early returns and its error
paths, then check each has a test naming that case. The recurring miss in this
project is a **new field in an object that is assembled key by key** — schemas
and patches accept it long before anything applies it.

### 4. Error paths

Every `catch`, every `if (!result.ok)`, every typed error with a `code`. A
failure path with no test is a message nobody has read: check it does not
produce a bare key, an unfilled placeholder or an empty string.

### 5. Tests written against the implementation

`it('calls onUpdate')` breaks the moment the call moves and says nothing about
behaviour. In the renderer specifically: **a query by class name is almost always wrong** —
it asserts styling, breaks on every refactor and proves nothing about what a
person can do.

Two exceptions, and only these: a class that is an interface rather than a look
(`.dark` on `<html>` is the theme switch, and `App.test.tsx` is right to assert
it), and reaching a native element with no accessible handle — `querySelector`
on a `<dialog>` to fire a `cancel` event. Anything else is styling.

## Writing what is missing

Follow `.claude/skills/core-module/SKILL.md` and
`.claude/skills/ui-component/SKILL.md`, and `docs/testing.md` for how the suite
is arranged. In short:

- core tests drive **real git** in a temporary directory, never a mock;
- renderer tests query by role, label, title or text;
- `window.octopus` is stubbed and typed as the real bridge;
- never point a test at `~/.octopus` — a repro that corrupts what it diagnoses
  is worse than no repro;
- reproduce a reported bug **before** fixing it.

## The rule that overrides the rest

**Never change source code to make a test pass.** An agent once deleted an abort
guard from a hook for exactly that reason, and the suite went green over a real
regression.

If a line looks unreachable, say so instead: it is either dead code worth
removing or a case worth understanding. Both are findings; neither is an edit to
the source in service of a test.

## Argument

With `fix`, write the missing tests and repair the hollow ones, then run the
gate. Without it, report what is missing and let the user choose.

## Finish

Report in three parts, shortest first:

1. **Bugs** — anything the audit found that is wrong in the source. Each with a
   test that fails against the current code.
2. **Hollow tests** — assertions that cannot fail, with what they should assert.
3. **Gaps** — untested branches, fields and error paths.

If the suite is sound, say so plainly rather than inventing findings.

Replies to the user are in Ukrainian; everything written into the repository is
English.
