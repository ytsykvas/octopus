# octopus

A local macOS app for running Claude Code sessions in parallel: every task lives
in its own git worktree — with its own branch, agent conversations and dev server
on a dedicated port.

Instead of waiting for one task to finish, you start several at once. They never
see each other and never conflict.

## What it does

**A workspace per task.** Adding one cuts a git worktree and a branch, and gives
it a block of ten ports. Up to three agent conversations can run in it at once;
each keeps its own transcript, model and mode, and survives a restart of the app.

**Build and run, on one button.** A project holds three scripts — `setup.sh`,
`run.sh`, `archive.sh` — and Run does the first two in order. Several workspaces
can serve at the same time: `$OCTOPUS_PORT` and `$OCTOPUS_PORT_1`…`_9` come from
a pool at 3100–3299, checked on the way into every run in case something else has
taken one since.

**The files a fresh worktree does not have.** A worktree holds what git tracks,
so a gitignored `.env` or `config/master.key` is missing from every new one. A
project names the files to copy in, and can add a block of `KEY=value` overrides
written at the end of the workspace's env file — where last wins. `$OCTOPUS_PORT`
in that block becomes that workspace's own port.

**Review and open a pull request.** The right pane shows the diff against the
base branch, takes comments on it, and opens a PR through `gh` — with a
description the agent writes to whatever instructions the project keeps.

**The agent is the one you already have.** octopus loads the same settings
Claude Code loads in a terminal: the project's `CLAUDE.md`, its `.claude/`
commands, skills and subagents. It adds nothing of its own to the context. A
repository that ships settings which pre-approve tools or run hooks is shown to
you once, before any of it is believed.

## Requirements

- macOS
- Node.js 22+
- git
- [Claude Code](https://claude.com/claude-code) — the app drives it
- [`gh`](https://cli.github.com), signed in, for cloning from GitHub and for
  pull requests. Everything else works without it.

## Running

```bash
npm install
npm run dev
```

Only one copy runs at a time — it takes Electron's single-instance lock.

If `npm run dev` fails with `Error: Electron uninstall`, the Electron binary was
not downloaded during install:

```bash
node node_modules/electron/install.js
```

If a terminal will not open and the error mentions `NODE_MODULE_VERSION`, the
native rebuild of `node-pty` did not run:

```bash
npx electron-rebuild -f -w node-pty
```

## Where things are kept

Everything lives under `~/.octopus`: `config.json`, `state.json`, one JSONL
transcript per conversation, the per-project scripts and env, and the worktrees
themselves. Nothing is written inside your repository except the worktree and its branch —
see [docs/data.md](docs/data.md). Removing a workspace offers to delete that
branch with it, ticked by default.

## Development

```bash
npm run check    # full gate: format, lint, types, tests with coverage
npm test         # tests
npm run build    # typecheck and build
```

`npm run check` must pass before every commit. Coverage is held at **100% across
`src`** by a threshold that fails the build when it drops.

`src/main/`, `src/preload/` and anything in `src/core/` they import **do not hot
reload** — a change there reaches the app only after `npm run dev` is restarted.

## Layout

```
src/core/         application logic, headless, no Electron
src/main/         Electron main process, thin IPC bridge, pseudo-terminals
src/preload/      typed bridge to the renderer
src/renderer/     UI (React + Tailwind + i18next)
docs/             why things are shaped as they are — start at docs/README.md
docs/PROJECT.md   the original intent, decisions and requirements
```

## Localisation

English is the default and the source of truth. Translations live in
`src/renderer/src/i18n/locales/`; Ukrainian ships alongside English. TypeScript
requires every locale to carry every key.

## Not there yet

Notifications, a Monaco-based diff, Linux and Windows builds, and everything
around a pull request past opening it — checks and review threads. Work already
identified but not done is written down one file at a time in
[docs/tasks/](docs/tasks/).

## Licence

Private project for personal use.
