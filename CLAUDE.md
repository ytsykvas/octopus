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

## Project infrastructure

**Skills** (`.claude/skills/`) load automatically when relevant:

| Skill          | Trigger                                       |
| -------------- | --------------------------------------------- |
| `core-module`  | automatically when touching `src/core/**`     |
| `ui-component` | automatically when touching `src/renderer/**` |
| `agent-sdk`    | when integrating with the Claude Agent SDK    |
| `/check`       | manual — quality gate with plain explanations |
| `/ship`        | manual — gate plus a conventional commit      |

**Subagent** `octopus-reviewer` reviews against this project's standards.

**Hooks** (`.claude/hooks/`) run automatically:

- `protect-core.sh` — **blocks** importing `electron` inside `src/core/`;
- `format-file.sh` — formats and lints every edited file.

So formatting never needs a manual run, and the main architectural invariant
cannot be broken by accident.

## Standards (details in §11.3 of docs/PROJECT.md)

- No `any`; use `unknown` and narrow it.
- External data is validated with zod at the boundary; types come from `z.infer`.
- External processes go through `execFile`, never `exec`.
- All paths through `path.join()`; no hardcoded `~/Library` or `/Users/...`.
- **`src/core/` coverage is 100%**, enforced by a threshold that fails the build.
  UI and IPC are covered by substance, not by chasing a number.
- Tests are written alongside the code. A bug is reproduced by a test first.
- Comments explain **why**, not **what**.
- Conventional Commits; never commit straight to `main`.

Never lower the coverage threshold or disable a lint rule to make the gate pass.

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

The `electron` package's `postinstall` sometimes fails silently to download the
binary. Symptom: `npm run dev` fails with `Error: Electron uninstall` even though
the build succeeds.

```bash
ls node_modules/electron/dist   # must exist
node node_modules/electron/install.js
```

## Out of scope for now

Terminal, Monaco diff, GitHub PRs, notifications, Linux builds, auth service.
