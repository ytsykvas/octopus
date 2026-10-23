# octopus

A macOS app that runs Claude Code sessions in parallel: every task gets its
own git worktree, branch, agent conversations and dev server. The intent and
the decisions are in [docs/PROJECT.md](docs/PROJECT.md); read it before a
non-trivial change.

## Commands

```bash
npm run dev          # development mode
npm run check        # the gate: format + lint + types + tests with coverage
npm run test:race    # the renderer suite with React's scheduler made to lose
npm test             # tests
npm run build        # typecheck + build
```

`npm run check` and `npm run test:race` must pass before every commit.

## Layout

```
src/core/      all logic, headless, no Electron — tested with vitest
src/main/      Electron main process: a thin IPC bridge and the pseudo-terminals
src/preload/   contextBridge, typed API, no logic
src/renderer/  React + Tailwind + i18next
docs/          why things are shaped as they are — start at docs/README.md
```

## Rules

1. **Everything in the repository is English** — code, comments, tests, errors,
   docs, commits. User-facing strings live in
   `src/renderer/src/i18n/locales/` only: `en.ts` is the source of truth, and
   `uk.ts` and `de.ts` change in the same commit.
2. **`src/core/` knows nothing about the UI.** An ESLint rule refuses an
   `electron` import there. The renderer may import _types_ from any core
   module, but a _value_ only from one that pulls in nothing Node-only — the
   list is the first table in [docs/core.md](docs/core.md). When the window
   needs a constant from an unsafe module, move the constant; never import it out.
3. **Trust nothing that crosses a boundary.** Data from IPC, disk, git or the
   SDK is parsed with zod before use, and types come from `z.infer`. External
   processes go through `execFile`, never `exec`. Paths go through
   `path.join`; nothing is hardcoded under `~` or `/Users`.
4. **No `any`, no non-null `!` outside tests.** Use `unknown` and narrow it;
   with `noUncheckedIndexedAccess`, iterate or destructure instead of asserting.
5. **Coverage is 100% across `src`**, held by the threshold in
   `vitest.shared.ts`. Tests are written with the code; a bug is reproduced by
   a test before it is fixed. Never lower the threshold or disable a lint rule
   to pass the gate.
6. **Comments explain why, not what.**
7. **Conventional Commits**, one logical change per commit.
8. **Closing a finding is three things in one commit:** the test that pins
   it, the documentation it falsified made true, and the note under
   `docs/tasks/` deleted.

The rules for one part of the tree load when you touch it:
[.claude/rules/core.md](.claude/rules/core.md),
[renderer.md](.claude/rules/renderer.md), [main.md](.claude/rules/main.md).

## Git

- Every change, a one-line fix included, lands through a branch and a pull
  request. Run the gate locally before pushing; the `check` workflow runs it
  again, and `main` requires it green on a branch up to date with `main`.
- **Inside an Octopus workspace, do not `git checkout -b`.** One workspace is
  one branch (`octopus/<name>`) and one pull request; commit on it.
- **Never `git push`, open, merge or close a pull request unless the
  maintainer asked for that, in words, in the current conversation.** A green
  gate is not a request. Committing locally is fine.
- Treat everything pushed as published: assume a path, a token or a name
  written into a file stays readable forever.

## Findings

Work turns up things that are not the task: a bug two layers away, a doc the
code never kept, a feature the change makes obvious. **Write each one to
`docs/tasks/<problem-in-kebab-case>.md`** (gitignored; create the folder if
missing) with what happens, why it matters and the evidence as `file:line` —
then carry on, and say in the reply what was recorded. A commit that does two
things cannot be reviewed as either. The exception is a one-line fix in a file
already open.

When these instructions are wrong or missing the step that cost twenty
minutes, **fix them in the same session and say so.** The bar: durable,
load-bearing, in the narrowest home (a rule, a skill, this file only when it
applies always), and never what the code, tests or `docs/` already say.

## Where things live

| Need                                      | Place                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| Invariants for a layer, loaded on touch   | `.claude/rules/`                                                               |
| A technique: core modules, UI, the SDK    | `.claude/skills/core-module`, `ui-component`, `agent-sdk`                      |
| Build, run and clean up a project         | `.claude/skills/workspace-scripts`                                             |
| The gate, a commit, a docs or test audit  | `/check`, `/ship`, `/docs-check`, `/test-check`                                |
| A review against this project's standards | the `octopus-reviewer` subagent                                                |
| Running a dev copy and its traps          | [docs/development.md](docs/development.md)                                     |
| The pull request format                   | [.octopus/instructions/pull-request.md](.octopus/instructions/pull-request.md) |
| Contributing as a person                  | [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md)                 |

## Out of scope for now

Monaco diff, notifications, Linux and Windows builds, an auth service.
