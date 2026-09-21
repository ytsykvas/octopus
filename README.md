<div align="center">

<img src="src/renderer/src/assets/octopus.png" width="120" alt="">

# octopus

**Run Claude Code sessions in parallel.** Every task lives in its own git
worktree — with its own branch, agent conversations and dev server on a
dedicated port.

[![check](https://github.com/ytsykvas/octopus/actions/workflows/check.yml/badge.svg)](https://github.com/ytsykvas/octopus/actions/workflows/check.yml)
[![licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
![macOS, Apple Silicon](https://img.shields.io/badge/macOS-Apple%20Silicon-111111)

[Quick start](#quick-start) · [What it does](#what-it-does) · [Docs](docs/README.md) · [Contributing](CONTRIBUTING.md)

</div>

octopus is a local macOS app for starting several Claude Code tasks at once
instead of waiting for one to finish. Each task gets a worktree, a branch, up to
three agent conversations and a dev server of its own, so they never see each
other and never conflict.

## Quick start

You build it yourself — there are no downloads, and [that is deliberate](#why-there-are-no-downloads).
You need macOS 11+ on Apple Silicon, Node.js 22+, git and a Claude Code login;
[the details](#installing) are below.

```bash
git clone https://github.com/ytsykvas/octopus.git
cd octopus
npm install
npm run dist
```

That leaves `Octopus.app` in `dist/mac-arm64/`. Drag it to Applications and open
it — no warning, no security prompt, nothing to click through.

## Why, when Claude Code already has worktrees

Claude Code can make a worktree by itself, and for one task at a time that is
enough. This is for the case where it is not: **several tasks running at once,
each needing more than a directory.**

A task here is not just a worktree. It is a branch, up to three agent
conversations with their own transcripts, a dev server on a port that will not
collide with the other tasks', the gitignored files a fresh worktree does not
have, and a diff you can read and comment on. Starting that by hand is a
sequence you would not repeat willingly five times a day; the point of the app
is that it is one click, five times a day.

octopus adds nothing of its own to the agent's context, is open source and
local-only, and is built to one person's taste.

## What it does

- **A workspace per task.** Adding one cuts a git worktree and a branch, and
  gives it a block of ten ports. Up to three agent conversations run in it at
  once; each keeps its own transcript, model and mode, and survives a restart.
- **Build and run, on one button.** A project holds three scripts — `setup.sh`,
  `run.sh`, `archive.sh` — and Run does the first two in order. Several
  workspaces can serve at the same time, each on its own port.
- **The files a fresh worktree does not have.** A worktree holds what git
  tracks, so a gitignored `.env` or `config/master.key` is missing from every new
  one. A project names the files to copy in — from its own checkout, or from
  another one on the same disk, which is the answer when it was cloned from
  GitHub — and can add a block of `KEY=value` overrides on top.
- **Settings that survive the machine.** Scripts, carried files and instructions
  can live in `~/.octopus`, which goes when the disk does, or in the repository
  itself under `.octopus/`. The repository wins, so a clone works with nothing
  configured. What it may never carry is a credential: a pull can change what
  runs and never what it runs against, and a script arriving that way is shown
  before it runs.
- **The whole pull request, from here.** The right pane shows the diff against
  the base branch, takes comments on it and opens a PR through `gh`, with a
  description the agent writes to your project's instructions. It then follows
  the PR: checks, review verdict, threads, and merge, squash or rebase when it is
  ready.
- **The agent is the one you already have.** octopus loads the same settings
  Claude Code loads in a terminal — the project's `CLAUDE.md`, its `.claude/`
  commands, skills and subagents — and adds nothing to the context. A repository
  that ships settings which pre-approve tools or run hooks is shown to you once,
  before any of it is believed.

The details behind each of these — the port pool, the env block, what a diff
counts — are in [docs/](docs/README.md).

## Installing

**What you need first:**

- **macOS 11 or later, Apple Silicon**
- **Node.js 22+** and **git**
- a **[Claude Code](https://claude.com/claude-code) login** — the agent runs on
  your authentication, and the app never handles credentials itself. The `claude`
  CLI is what the Settings account panel signs in and out through.
- **[`gh`](https://cli.github.com)**, signed in, for cloning from GitHub and for
  pull requests. Everything else works without it.

The agent itself is not one of these: the Claude Code binary comes down with
`npm install` and lives inside the app.

Then follow the [quick start](#quick-start). To run it in development instead,
use `npm run dev`. Only one copy runs at a time: it takes Electron's
single-instance lock.

### Why there are no downloads

macOS refuses to open a downloaded app unless it is signed with an Apple
certificate ($99/year) and notarised. Refuses, not warns — it reports the app as
**damaged** and offers only the Trash, and there is no "Open Anyway" for it.

An app you build on your own machine was never downloaded, so none of that
applies. It just opens. Publishing an unsigned build would give every single
person that dialog, so this is not a placeholder for a download link that is
coming later.

### If something goes wrong

`npm run dev` failing with `Error: Electron uninstall` means the Electron binary
did not download during install:

```bash
node node_modules/electron/install.js
```

A terminal that will not open points at the native build of `node-pty`:

```bash
npx electron-builder install-app-deps
```

## Where things are kept

Everything lives under `~/.octopus`: `config.json`, `state.json`, one JSONL
transcript per conversation, the per-project scripts and env, and the worktrees
themselves. Nothing is written inside your repository except the worktree and its
branch — see [docs/data.md](docs/data.md). Removing a workspace offers to delete
that branch with it, ticked by default.

## Development

```bash
npm run check    # full gate: format, lint, types, tests with coverage
npm test         # tests
npm run build    # typecheck and build
```

`npm run check` must pass before every change lands. Coverage is held at **100%
across `src`** by a threshold that fails the build when it drops.

`src/main/`, `src/preload/` and anything in `src/core/` they import **do not hot
reload** — a change there reaches the app only after `npm run dev` is restarted.

```
src/core/         application logic, headless, no Electron
src/main/         Electron main process, thin IPC bridge, pseudo-terminals
src/preload/      typed bridge to the renderer
src/renderer/     UI (React + Tailwind + i18next)
docs/             why things are shaped as they are — start at docs/README.md
```

English is the default language and the source of truth for the interface;
Ukrainian ships alongside it, in `src/renderer/src/i18n/locales/`. TypeScript
requires every locale to carry every key.

[CONTRIBUTING.md](CONTRIBUTING.md) covers the conventions the repository keeps.
[docs/PROJECT.md](docs/PROJECT.md) holds the original intent and decisions.

## Roadmap

Not there yet: notifications, a Monaco-based diff, and Linux and Windows builds.
Ideas and bugs are tracked as [issues](https://github.com/ytsykvas/octopus/issues).

## Contributing

Pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the gate
every change has to pass and the conventions the repository keeps.

## Author

**Yurii Tsykvas** — happy to hear from you about this or anything near it.

- Telegram — [@tsykvas](https://t.me/tsykvas)
- LinkedIn — [in/tsykvas](https://www.linkedin.com/in/tsykvas)

Bugs and feature requests are better as issues than as messages: they stay
searchable for whoever hits the same thing next.

## Licence

[MIT](LICENSE).
