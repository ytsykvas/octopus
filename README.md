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
other and never conflict. A board per project holds the tasks still to come as
Markdown cards, and one click turns a card into a workspace.

## Quick start

You build it yourself — there are no downloads, and [that is deliberate](#why-there-are-no-downloads).
You need macOS 13+ on Apple Silicon, Node.js 22.22+, git and a Claude Code
login; [the details](#installing) are below.

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

### Workspaces

- **A workspace per task.** Adding one fetches the base branch, cuts a git
  worktree and a branch named for the kind of work — `octopus/feature/kira`,
  `octopus/fix/…`, one of twelve kinds drawn as a coloured strip on its card —
  and gives it a block of ten ports. Workspaces are dragged into the order you
  want them in.
- **Build and run, on one button.** A project holds three scripts — `setup.sh`,
  `run.sh`, `archive.sh` — and Run, in the Scripts tab or the title bar, does
  the first two in order. Several workspaces can serve at the same time, each on
  its own port, and `archive.sh` cleans up when a workspace is removed.
- **The files a fresh worktree does not have.** A worktree holds what git
  tracks, so a gitignored `.env` or `config/master.key` is missing from every new
  one. A project names the files to copy in — from its own checkout, or from
  another one on the same disk, which is the answer when it was cloned from
  GitHub — and can add named sets of `KEY=value` overrides on top, chosen per
  workspace.
- **Settings that survive the machine.** Scripts, carried files and instructions
  can live in `~/.octopus`, which goes when the disk does, or in the repository
  itself under `.octopus/`, so a fresh clone has its scripts and instructions
  with nothing configured. What it says about which files to carry, where work
  is cut from and where credentials go waits until you trust the repository,
  and then its carry list adds to the project's own. What it may never carry is
  a credential: a pull can change what runs and never what it runs against, and
  a script arriving that way is shown before it runs, unless you trust the
  repository.
- **Hard to lose work by accident.** Removing a workspace offers to delete its
  branch, but commits that exist nowhere else go only after a second, explicit
  question. `state.json` keeps a backup beside it, and when it cannot be read
  the app offers that backup before it opens.

### The agent

- **The agent is the one you already have.** octopus loads the same settings
  Claude Code loads in a terminal — the project's `CLAUDE.md`, its `.claude/`
  commands, skills and subagents — and adds nothing to the context. Skills,
  commands and subagents of your own are made and imported in Settings, and a
  plugins window lists what is installed beside a store. A repository that ships
  settings which pre-approve tools or run hooks is shown to you once, before any
  of it is believed.
- **A chat that shows the work.** Up to three conversations run in a workspace
  at once; each keeps its own transcript, model, effort and mode — Plan,
  Manual, Accept edits, or Auto, where the SDK's classifier decides — and
  survives a restart. A closed one waits in the workspace's history to be
  reopened, and any conversation can be rewound to before a message, with the
  files its edits touched. A plan is read in a dialog and can be handed to a fresh chat to carry
  out, and the `opusplan` preset plans on Opus and builds on Sonnet. Background
  subagents get a map of their own, where each one can be stopped alone, and
  `/btw` questions are answered in a drawer beside the chat. A panel shows what
  fills the context window, and `/compact` can be told what to keep, then shows
  what it saved and what the agent kept.
- **It stays on its branch and never publishes.** Every session carries guards
  that refuse switching or renaming the workspace's branch, and refuse pushing
  or opening, merging or closing a pull request: those belong to the pull
  request pane, so nothing reaches the remote by accident.
- **Saved prompts, a click away.** Prompts are kept for every project or for
  one and ordered in Settings. They fan out from a button above the composer's
  field, beside the checkout's own `.claude/commands`, and the ones marked for
  plans fan out in the plan dialog too.
- **Help that writes the ask.** The Help menu at the foot of the workspace list
  opens a conversation that sets a project up to run, or works out why Run
  fails, and sends it what the agent cannot find for itself: the workspace's
  port, whether anything answers there, the scripts and env in effect, and the
  last run's output.
- **Agents out of sight still reach you.** When an agent finishes, fails or
  asks something in a workspace you are not looking at, a quiet toast and a
  chime say so. A status bar counts the agents at work, the open pull requests
  and what each workspace's processes hold in memory, and the sidebar shows the
  account's usage limits.

### The right pane

- **The whole pull request, from here.** The diff against the base branch takes
  comments that ride out with your next message, and the pane opens a PR
  through `gh`, with a description written to your project's instructions by
  the model of the chat that last worked. It then follows the PR: checks, which
  are re-run or handed to the agent when they fail; the review verdict and its
  threads, answered and resolved from here; and merge, squash or rebase when it
  is ready. When GitHub will merge a branch only once it is up to date, the
  pane offers to bring the base in first, and a merged PR offers to remove its
  workspace.
- **The worktree, readable.** A Files tab shows the tree with tabs of open
  files, and marks every file and line the branch has changed since it began,
  not only since the last commit. A Terminal tab keeps a shell per workspace
  running while you look elsewhere, and a Notes tab holds a note of your own
  that the agent never reads.

### The board

- **A board of tasks per project.** A switch in the title bar turns the window
  into the project's tasks as columns — Backlog, In progress, Testing, Staging,
  Done and Blocked, plus any you add, rename or reorder — read from Markdown
  files in a folder you choose, one folder per column. Put it in a folder iCloud
  syncs and every Mac shows the same board; a change made elsewhere appears as
  it lands. A card opens in a side panel with a Markdown editor and preview, a
  priority, a tag, comments, links and attached files. Cards are dragged
  between columns, filtered and searched, and the whole board is driven from
  the keyboard.
- **From a card to a workspace.** Run makes a workspace from a card and puts
  the card's text in its first conversation, waiting and unsent. The card then
  shows that workspace's state and pull request. The request, the merge, the
  run's turns, time and tokens, and the account and the machine it ran on are
  written back into its file, so another Mac sees them too — and so does
  anything else that reads the folder.

### The window

- **Keyboard, theme and language.** ⌘⇧N makes a workspace, ⌘1–⌘9 and ⌃1–⌃9
  switch project and workspace, ⌥1–⌥3 the conversation, and ⌘⇧E, ⌘⇧D and ⌘⇧P
  the right pane's tabs — [the full list](docs/PROJECT.md#shortcuts). The
  window follows the system's light or dark theme or keeps one, in English,
  Ukrainian or German.

The details behind each of these — the port pool, the env sets, what a diff
counts, how a card is stored — are in [docs/](docs/README.md).

## Built with

- **Electron** and **electron-vite**, for a desktop app whose logic never
  touches Electron: everything under `src/core/` runs headless and is tested
  without a window.
- **React 19**, **Tailwind 4** and **i18next**, with the interface in English,
  Ukrainian and German.
- **TypeScript** in strict mode, with **zod** parsing every value that crosses
  a boundary — IPC, files on disk, the output of `git` and `gh`.
- The **Claude Agent SDK** for the conversations, drawn with **assistant-ui**
  and **react-markdown**; **node-pty** and **xterm** for the terminals;
  **shiki** for the colours of the diff and the file viewer; **CodeMirror 6**
  for the board's Markdown editor.
- **Vitest**, with coverage held at 100% across `src` by a threshold that
  fails the build, and a second run that makes React's scheduler lose every
  race the suite could otherwise win by luck.

How the four layers divide the work is under [Development](#development).

## Working with agents

The repository carries its own Claude Code setup, and it is part of what is
being shown here:

- [CLAUDE.md](CLAUDE.md) is a short root that links out, and the invariants of
  each layer live in [.claude/rules/](.claude/rules), loaded only when a file
  there is touched.
- [.claude/skills/](.claude/skills) hold the techniques — core modules, the
  interface, the Agent SDK — and the workflows: `/check`, `/docs-check`,
  `/test-check`, and `workspace-scripts`, which sets a project up to run in
  octopus.
- A reviewer subagent holds a change to the same list, a hook formats every
  file an agent edits, and the permissions allow the gate and nothing wider.
- The reference documentation under [docs/](docs/README.md) is split by
  subject, so a question about one pane reads one file.
- [AGENTS.md](AGENTS.md) sends agents that do not read `CLAUDE.md` to it, and
  `.agents/skills/` and `.codex/agents/` carry the same skills and reviewer for
  Codex.

octopus opens a repository's settings and hooks to the person before any of
them run, this one included.

## Installing

**What you need first:**

- **macOS 13 or later, Apple Silicon**
- **Node.js 22.22+** (or 24.15+) and **git**
- a **[Claude Code](https://claude.com/claude-code) login** — the agent runs on
  your authentication, and the app never handles credentials itself.
- **[`gh`](https://cli.github.com)**, signed in, for cloning from GitHub and for
  pull requests. Everything else works without it.

The agent itself is not one of these: the Claude Code binary comes down with
`npm install` and lives inside the app. A `claude` CLI of your own, on your
`PATH`, is what the Settings account panel signs in and out through, and what
names the account a board card's run is written with; without it the app works
and says the account is not connected.

Then follow the [quick start](#quick-start). To run it in development instead,
use `npm run dev`. Only one copy runs at a time: it takes Electron's
single-instance lock. A second copy with a data directory of its own runs
beside it — see [CONTRIBUTING.md](CONTRIBUTING.md#running-a-development-copy).

### Why there are no downloads

macOS refuses to open a downloaded app unless it is signed with an Apple
certificate ($99/year) and notarised. Refuses, not warns — it reports the app as
**damaged** and offers only the Trash, and there is no "Open Anyway" for it.

An app you build on your own machine was never downloaded, so none of that
applies. It just opens. Publishing an unsigned build would give every single
person that dialog, so this is not a placeholder for a download link that is
coming later.

### If something goes wrong

`npm run dev` failing with `Error: Electron uninstall`, or with
`spawn …/Electron.app/… ENOENT`, means Electron's binary was never fetched —
since Electron 42 it comes down the first time something requires it, not
during install:

```bash
node node_modules/electron/install.js
```

A terminal that will not open points at the native build of `node-pty`:

```bash
npx electron-builder install-app-deps
```

Errors the app catches to keep a session alive are written, with their stacks,
to `~/Library/Logs/octopus/main.log`. The reasons, and the other traps of a
development copy, are in [docs/development.md](docs/development.md).

## Where things are kept

Almost everything lives under `~/.octopus`: `config.json`, `state.json` and its
backup `state.json.bak`, the saved prompts in `prompts.json`, one JSONL
transcript per conversation, your own instructions and skills, each project's
scripts, carry list, env sets, prompts and instructions, and the worktrees
themselves. Two things live elsewhere: the board, in the folder chosen in
Settings → Board, with a folder per project and per column and a Markdown file
per card; and the error log, in `~/Library/Logs/octopus/`.

Inside your repository octopus writes only the worktree and its branch — and
`.octopus/`, when you export a project's settings there. See
[docs/data/](docs/data/README.md).

## Development

```bash
npm run check      # full gate: format, lint, types, tests with coverage
npm run test:race  # interface tests with React's scheduler made to lose
npm test           # tests
npm run build      # typecheck and build
```

`npm run check` and `npm run test:race` must pass before every change lands,
and CI runs both again. Coverage is held at **100% across `src`** by a
threshold that fails the build when it drops.

`src/main/`, `src/preload/` and anything in `src/core/` they import **do not hot
reload** — a change there reaches the app only after `npm run dev` is restarted
([docs/development.md](docs/development.md)).

```
src/core/         application logic, headless, no Electron
src/main/         Electron main process, thin IPC bridge, pseudo-terminals
src/preload/      typed bridge to the renderer
src/renderer/     UI (React + Tailwind + i18next)
docs/             why things are shaped as they are — start at docs/README.md
```

English is the default language and the source of truth for the interface;
Ukrainian and German ship alongside it, in `src/renderer/src/i18n/locales/`.
TypeScript requires every locale to carry every key.

[CONTRIBUTING.md](CONTRIBUTING.md) covers the conventions the repository keeps.
[docs/PROJECT.md](docs/PROJECT.md) holds the original intent and decisions.

## Roadmap

Not planned for this stage ([docs/PROJECT.md](docs/PROJECT.md#15-out-of-scope-for-stage-1)):
a Monaco diff, system notifications, archiving a workspace instead of removing
it, Linux builds, and a signed and notarised download. Ideas and bugs are
tracked as [issues](https://github.com/ytsykvas/octopus/issues).

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

The file icons in the Files tab are from
[Catppuccin Icons](https://github.com/catppuccin/vscode-icons), under its own
MIT licence, which ships inside the app. They are kept in `vendor/` as the
release published them; `npm run vendor:icons` replaces them with the release
pinned in `scripts/vendor-icons.ts`.
