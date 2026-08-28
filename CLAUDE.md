# octopus

A local macOS app for running Claude Code sessions in parallel: every task runs in its own
git worktree, with its own branch, agent session and dev server.

**Full context is in `docs/PROJECT.md`.** Read it before non-trivial changes.

## Language policy

**The entire repository is English** — code, comments, test names, error messages,
documentation and commit messages. No exceptions.

User-facing strings never appear inline. They live in
`src/renderer/src/i18n/locales/`, with English as the source of truth and the
default language. Add the key to `en.ts` first; TypeScript then requires every
other locale to match.

Core throws errors carrying a machine-readable `code`, which the renderer maps
onto a localised message. The English text on the error is a fallback for logs.

## Commands

```bash
npm run dev          # development mode
npm run build        # typecheck + build
npm run check        # full gate: format + lint + types + tests with coverage
npm test             # tests
npm run test:watch   # tests in watch mode
```

`npm run check` must pass before every commit.

## Architecture

```
src/core/      all logic, headless, NO Electron imports — tested with vitest
src/main/      thin IPC bridge, no logic
src/preload/   contextBridge, typed API
src/renderer/  UI (React + Tailwind + i18next)
```

**The main rule:** `core/` knows nothing about the UI. A hook blocks importing
`electron` there.

**The rule in the other direction:** the renderer may import _types_ from any
core module, but a **value** only from one that pulls in nothing Node-only.
`colors.ts` and `initials.ts` are safe; `store.ts` reaches `node:os` through
`paths.ts`, and importing a constant from it broke the window at runtime while
every check stayed green — types are erased, values are not.

## Project infrastructure

**Skills** (`.claude/skills/`) load automatically when relevant:

| Skill             | Trigger                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| `core-module`     | automatically when touching `src/core/**`                              |
| `ui-component`    | automatically when touching `src/renderer/**`                          |
| `agent-sdk`       | when integrating with the Claude Agent SDK                             |
| `conductor-study` | when Conductor comes up, or before building a feature it already ships |
| `docs-check`      | when docs may have fallen behind the code                              |
| `test-check`      | when the suite may have gaps coverage cannot see                       |
| `/check`          | manual — quality gate with plain explanations                          |
| `/ship`           | manual — gate plus a conventional commit                               |

**Subagent** `octopus-reviewer` reviews against this project's standards.

**Hooks** (`.claude/hooks/`) run automatically:

- `protect-core.sh` — **blocks** importing `electron` inside `src/core/`;
- `format-file.sh` — formats and lints every edited file.

So formatting never needs a manual run, and the main architectural invariant
cannot be broken by accident.

## Findings that are not the current task

Work almost always turns up something else: a bug two layers away, a promise in
the docs the code never kept, a feature the change makes obvious.

**Write it to `docs/tasks/` as its own markdown file and carry on.** Do not fold
it into the change in hand. A commit that does two things cannot be reviewed as
either, and the task that was actually asked for is the one that ends up
unfinished.

Then **say what was recorded**, in the reply. A note filed silently is a note
nobody reads.

The exception is a one-line fix in a file already open — writing the note costs
more than the fix, so just fix it.

`docs/tasks/README.md` holds the convention: what a file carries, why there is
no status field, and why a finished task is deleted rather than marked done.

## Findings about these instructions

The same rule applies to the instructions themselves. Work regularly shows that
a line here is wrong, that a skill leaves out the step which cost twenty
minutes, or that a trap deserves a sentence so the next session does not walk
into it.

**Fix it in the same session, and say what was changed.** A lesson nobody wrote
down is one every later session learns again from nothing.

The bar, because this file is read at the start of every session and a line
added here is paid for in all of them:

- **Durable and load-bearing.** Would a later session get this wrong without it?
  "Renderer tests need their own vitest config" outlives the change and does;
  "the diff parser was fiddly" does neither.
- **The narrowest home wins.** A skill when it applies to one kind of work, a
  hook when it is mechanical enough to enforce, this file only when it applies
  always.
- **Prefer editing a line to adding one**, and deleting one that has gone stale
  is worth as much as writing a new one.
- Never write down what the code, the tests or `docs/` already say.

## Standards (details in §11.3 of docs/PROJECT.md)

- No `any`; use `unknown` and narrow it.
- External data is validated with zod at the boundary; types come from `z.infer`.
- External processes go through `execFile`, never `exec`.
- All paths through `path.join()`; no hardcoded `~/Library` or `/Users/...`.
- **Coverage is 100% everywhere**, enforced by a threshold that fails the build —
  `vitest.config.ts` and `vitest.renderer.config.ts` share it. Size the renderer
  tests accordingly; only the files in `bootstrapOnly` are exempt.
- Tests are written alongside the code. A bug is reproduced by a test first.
- Comments explain **why**, not **what**.
- Conventional Commits.
- No non-null assertions (`!`) outside tests: `strictTypeChecked` forbids them,
  and with `noUncheckedIndexedAccess` an indexed read is `T | undefined`.
  Iterate, destructure or rotate the array instead of reaching for `!` —
  `nextWorkspaceName` in `names.ts` is the worked example.

Never lower the coverage threshold or disable a lint rule to make the gate pass.

## Git

`origin` is a **public** repository, `ytsykvas/octopus`, MIT-licensed. Push only
when asked.

Public changes what care means. Nothing is retractable — a pushed commit is
mirrored and indexed within minutes, so a secret removed in the next commit has
still been published. Before writing a path, a token, a hostname or a real
name into a file, assume it stays readable forever.

**`main` is protected. Every change goes through a branch and a pull request** —
including one-line fixes, and including the author's own. Direct pushes are
refused by the remote, so this is not a convention to remember but a rule the
server keeps.

```bash
git checkout -b fix/short-description
# work, then
gh pr create --fill
```

A pull request merges once CI is green. Force pushes to `main` and deleting it
are blocked outright.

The protection does not cover administrators, which is the escape hatch for a
`main` that is broken and cannot be fixed through a pipeline that is also
broken. Reaching for it in any other situation defeats the point of having it.

## Design

A calm desktop interface: neutral base, 1px separators, restrained accents
(§10 of docs/PROJECT.md). Tokens live in `src/renderer/src/styles.css`.

Colours only through tokens, never raw hex — otherwise the dark theme breaks.
No `uppercase` or weight 900: the interface carries chat, diffs and logs, so the
styling has to stay out of the content's way.

## Talking to the user

The user writes in Ukrainian and expects replies in Ukrainian. That applies to
conversation only — everything written into the repository stays English.

The user does not know this stack: explain problems in plain language rather
than pasting tool output.

## Known traps

**`src/main/`, `src/preload/` and everything in `src/core/` they import do not
hot-reload.** Only the renderer does. A change there reaches the app only after
`npm run dev` is restarted — until then the old build is what runs, and a fix
that looks ineffective may simply not be loaded. Verified, not assumed.

Restart it yourself after touching those, before handing the app back. A schema
widened in `core/` while `main/` still validates against the old one produces an
error message listing values that no longer match the source — confusing to read
and entirely self-inflicted.

**Only one copy of the app runs at a time**, since it takes Electron's
single-instance lock. That turns one silent failure into a visible one and
creates a new symptom worth knowing: `pkill -f "electron-vite dev"` kills the
dev server but not the Electron process it spawned, and the next `npm run dev`
then loses the lock and quits. What you see is the **old build** focused and no
error at all. Kill it by path — `pkill -f "octopus/node_modules/electron/dist"`
— and never by `Electron`, which matches every other Electron app running,
this editor included.

**The running app holds the state in memory.** Editing `~/.octopus/state.json`
from the outside while it runs makes the two disagree, and the app will happily
act on its stale copy. Never reproduce a bug against the user's real state or
data root: point the service at a temporary directory instead. A repro that
corrupts the thing being diagnosed is worse than no repro.

The `electron` package's `postinstall` sometimes fails silently to download the
binary. Symptom: `npm run dev` fails with `Error: Electron uninstall` even though
the build succeeds.

```bash
ls node_modules/electron/dist   # must exist
node node_modules/electron/install.js
```

## Out of scope for now

Monaco diff, notifications, Linux builds, auth service.

Pull requests are not: the right pane runs the whole loop through `gh` —
committing, opening, the checks, the review, five prepared prompts and merging
(§12.4 of docs/PROJECT.md). What is still ahead is replying to a review thread
from here, which `docs/tasks/` holds.

## Native modules

`node-pty` is native, and `postinstall` builds it with
`electron-builder install-app-deps` — the same tool that packages the app, so
installing and packaging cannot disagree about the binding. `npm install` stays
one step. If the terminal will not open, that build is the first thing to
suspect:

```bash
npx electron-builder install-app-deps
```

It is built through Node-API, so the binary is **not** tied to Electron's ABI —
the same file loads in plain Node and in Electron, verified in both. Do not
reach for the ABI explanation when the terminal misbehaves; it is almost
certainly something else.
