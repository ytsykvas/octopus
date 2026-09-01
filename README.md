<div align="center">

<img src="src/renderer/src/assets/octopus.png" width="120" alt="">

# octopus

**Run Claude Code sessions in parallel.** Every task lives in its own git
worktree — with its own branch, agent conversations and dev server on a
dedicated port.

[![check](https://github.com/ytsykvas/octopus/actions/workflows/check.yml/badge.svg)](https://github.com/ytsykvas/octopus/actions/workflows/check.yml)
[![licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
![macOS, Apple Silicon](https://img.shields.io/badge/macOS-Apple%20Silicon-111111)

Built by **Yurii Tsykvas** — say hello:

[![Telegram](https://img.shields.io/badge/Telegram-@tsykvas-26A5E4?logo=telegram&logoColor=white)](https://t.me/tsykvas)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-message-25D366?logo=whatsapp&logoColor=white)](https://wa.me/qr/BIZ5LIYDL3THA1)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-tsykvas-0A66C2?logo=linkedin&logoColor=white)](https://www.linkedin.com/in/tsykvas)

</div>

Instead of waiting for one task to finish, you start several at once. They never
see each other and never conflict.

<!--
  SCREENSHOTS GO HERE — the one thing this README is still missing.

  Take three, put them in docs/screenshots/, and replace this comment:

    ![The three panes](docs/screenshots/window.png)
    ![Reviewing a diff](docs/screenshots/diff.png)
    ![Several workspaces at once](docs/screenshots/workspaces.png)

  Worth capturing: the full window with a real repository open; the right pane
  showing a diff with a comment on it; the workspace list with two or three
  running at the same time. Light or dark, but the same theme in all three.
-->

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

The other honest half: [Conductor](https://www.conductor.build/) does the same
thing well, and its layout is where this one's comes from. octopus differs by
adding nothing of its own to the agent's context, by being open source and
local-only, and by being built to one person's taste. If Conductor suits you,
use Conductor.

## What it does

**A workspace per task.** Adding one cuts a git worktree and a branch, and gives
it a block of ten ports. Up to three agent conversations can run in it at once;
each keeps its own transcript, model and mode, and survives a restart.

**Build and run, on one button.** A project holds three scripts — `setup.sh`,
`run.sh`, `archive.sh` — and Run does the first two in order. Several workspaces
can serve at the same time, each on its own port.

**The files a fresh worktree does not have.** A worktree holds what git tracks,
so a gitignored `.env` or `config/master.key` is missing from every new one. A
project names the files to copy in, and can add a block of `KEY=value` overrides
on top.

**Settings that survive the machine.** A project's scripts, carried files and
instructions can live in `~/.octopus`, which goes when the disk does — or in the
repository itself, under `.octopus/` or the `.conductor/` it may already have.
The repository wins, so a clone works with nothing configured, and a second
machine needs no setting up. What it may never carry is a credential: variables
stay on the machine, so a pull can change what runs and never what it runs
against. A script arriving that way is shown before it runs.

**Review and open a pull request.** The right pane shows the diff against the
base branch, takes comments on it, and opens a PR through `gh` — with a
description the agent writes to whatever instructions the project keeps.

**The agent is the one you already have.** octopus loads the same settings
Claude Code loads in a terminal: the project's `CLAUDE.md`, its `.claude/`
commands, skills and subagents. It adds nothing of its own to the context. A
repository that ships settings which pre-approve tools or run hooks is shown to
you once, before any of it is believed.

The details behind each of these — the port pool, the env block, what a diff
counts — are in [docs/](docs/README.md).

## Installing

You build it yourself. There are no downloads, and that is deliberate — see
[why](#why-there-are-no-downloads) below.

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

**Then:**

```bash
git clone https://github.com/ytsykvas/octopus.git
cd octopus
npm install
npm run dist
```

That leaves `Octopus.app` in `dist/mac-arm64/`. Drag it to Applications and open
it — no warning, no security prompt, nothing to click through.

To run it in development instead, `npm run dev`. Only one copy runs at a time:
it takes Electron's single-instance lock.

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

## Contributing

Pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the gate
every change has to pass and the conventions the repository keeps.

## Author

**Yurii Tsykvas** — happy to hear from you about this or anything near it.

- Telegram — [@tsykvas](https://t.me/tsykvas)
- WhatsApp — [message](https://wa.me/qr/BIZ5LIYDL3THA1)
- LinkedIn — [in/tsykvas](https://www.linkedin.com/in/tsykvas)

Bugs and feature requests are better as
[issues](https://github.com/ytsykvas/octopus/issues) than as messages: they stay
searchable for whoever hits the same thing next.

## Licence

[MIT](LICENSE).
