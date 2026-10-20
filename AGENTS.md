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
npm run test:race    # renderer suite with React's scheduler made to lose (CI runs it)
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
every check stayed green — types are erased, values are not. It has now happened
twice, so: when the window needs a constant that lives in a module which is not
safe, **move the constant** into one that is. Do not import it out. The list of
safe modules is the first table in `docs/core.md`, and a module joining it is
written down there before the import is written.

## Project infrastructure

**Skills** (`.agents/skills/`) load automatically when relevant:

| Skill               | Trigger                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `core-module`       | automatically when touching `src/core/**`                              |
| `ui-component`      | automatically when touching `src/renderer/**`                          |
| `agent-sdk`         | when integrating with the Claude Agent SDK                             |
| `workspace-scripts` | when a project needs its files, variables and scripts to build and run |
| `docs-check`        | when docs may have fallen behind the code                              |
| `test-check`        | when the suite may have gaps coverage cannot see                       |
| `/check`            | manual — quality gate with plain explanations                          |
| `/ship`             | manual — gate plus a conventional commit                               |

`.agents/skills/` is mirrored by the maintainer's local `.claude/skills/`. A
change to a skill belongs in both, and only the names differ: `AGENTS.md` for
`CLAUDE.md`, `.agents/` for `.claude/` in what is about the setup itself — never
in what is about the product, whose package is `@anthropic-ai/claude-agent-sdk`.

**Subagent** `octopus-reviewer` reviews against this project's standards.

**Hooks** exist only in the maintainer's local Claude Code setup
(`.claude/hooks/`). Under Claude Code they block importing `electron` inside
`src/core/` and format and lint every edited file. Under any other agent nothing
enforces either, so do both by hand: never import `electron` in `src/core/`, run
`npx prettier --write` on what you edited, and run `npm run check` before a
commit.

## Findings that are not the current task

Work almost always turns up something else: a bug two layers away, a promise in
the docs the code never kept, a feature the change makes obvious.

**Write it to `docs/tasks/` as its own markdown file and carry on.** Do not fold
it into the change in hand. The folder is local and gitignored: create it if it
is missing. A commit that does two things cannot be reviewed as
either, and the task that was actually asked for is the one that ends up
unfinished.

Then **say what was recorded**, in the reply. A note filed silently is a note
nobody reads.

The exception is a one-line fix in a file already open — writing the note costs
more than the fix, so just fix it.

One file per finding, named for the problem in kebab-case. It carries what
happens, why it matters and the evidence as `file:line`. There is no status
field: a file is open work, and it is deleted in the commit that lands the fix.

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
- **Closing a finding is three things, and none of them waits to be asked:** a
  test that pins it, the documentation it falsified made true, and the note
  deleted from `docs/tasks/`. They belong in the commit that fixes it, not in a
  pass afterwards — and a pass afterwards found something every time it was
  run, which is how this line was earned. Publishing it (push, pull request,
  merge) does wait to be asked; see Git.
- **A field added to anything under `StateSchema` needs a default.** The reader
  throws on a mismatch rather than falling back, so a record written before the
  field must still load — and `state.json` holds more than it looks: the last
  usage reading is in there, so every field of a _window_ is a stored field
  while the module around it describes a live response. Two added without
  defaults stopped the whole file parsing and the app would not open at all.
  The test that catches it is one line in `store.test.ts`: write the older
  shape, load it.
- **Verify a guard by reverting it.** 100% coverage says the line ran, not that
  anything would notice if it went. Six audits in a row found tests that were
  green with the fix removed: an assertion made before React flushed, a count of
  calls that held either way, a bench array required by a type and read by
  nothing. Put the bug back; the suite must go red.
- Comments explain **why**, not **what**.
- Conventional Commits.
- No non-null assertions (`!`) outside tests: `strictTypeChecked` forbids them,
  and with `noUncheckedIndexedAccess` an indexed read is `T | undefined`.
  Iterate, destructure or rotate the array instead of reaching for `!` —
  `nextWorkspaceName` in `names.ts` is the worked example.

Never lower the coverage threshold or disable a lint rule to make the gate pass.

## Git

`origin` is `ytsykvas/octopus`, MIT-licensed and **public**. `CLAUDE.md`,
`.claude/` and `docs/tasks/` are gitignored: they are this maintainer's local
Claude Code setup and never reach the remote, so nothing a contributor reads may
depend on them. `AGENTS.md`, `.agents/` and `.codex/` are the tracked,
shared equivalent for other agents.

**`main` is protected and refuses direct pushes, administrators included.** It
was private with no protection at first and the very next push went through
carrying `Bypassed rule violations` — a protection the only person who commits
here can step over is decoration. Every change, a one-line fix included, goes
through a branch and a pull request, and merges once CI is green — when the
maintainer asks for each step (the hard rule below):

**Inside an Octopus workspace, do not `git checkout -b`.** One workspace is one
branch and one pull request: the app finds both by the workspace's branch
(`octopus/<name>`), so commit on it. A second
independent change belongs in another workspace. Agents the app runs are refused
the branch switch outright (`branchGuard.ts`); this line is for the ones it does
not run. The recipe below is for a plain checkout:

```bash
git checkout -b fix/short-description
# work, then `npm run check`
git push -u origin fix/short-description
gh pr create --title "fix: …" --body-file body.md
```

**The pull request itself**, when you are asked to write one — in English like
everything else here:

- **Title** — Conventional Commits, imperative, under 72 characters. A squash
  merge makes it the commit on `main`, so it is written as one.
- **`## Summary`** — under five sentences: the behaviour change, the modules and
  components touched, the tests added. It covers the whole branch
  (`git diff origin/main...HEAD`), not only this session's part. Strings are
  mentioned only when `en.ts` and `uk.ts` gained or changed keys — never a
  "no strings changed" line.
- **`## Reason and result`** — plain language for someone who does not read
  code, with three labelled parts: **Problem**, **Before** and **After**, the
  last two as the person using the app sees it. The five-sentence limit is not
  this section's.
- Nothing that lives only in the maintainer's setup — `docs/tasks/`,
  `CLAUDE.md`, `.claude/`: the repository is public and the reader cannot follow
  it.

**Hard rule: never `git push`, open a pull request or merge one unless the
maintainer asked for that, in words, in the current conversation.** Finishing a
task, closing a finding or a green `npm run check` is not asking. Committing
locally is fine; publishing is not, and a request to commit is not a request to
push. The one exception is the maintainer having asked for it. Beyond that,
anything destructive other than deleting a landed task note needs asking too,
and `git push --force` is refused by the local `deny`.

If `main` is ever broken so badly that it cannot be fixed through a pipeline
that is also broken, turn the protection off deliberately in Settings and back
on afterwards. That is visible; a silent bypass on every push is not.

Everything pushed is published: a commit is mirrored and indexed within minutes,
so a secret removed in the next commit has still been seen. Before writing a
path, a token, a hostname or a real name into a file, assume it stays readable
forever.

## Design

A calm desktop interface: neutral base, 1px separators, restrained accents
(§10 of docs/PROJECT.md). Tokens live in `src/renderer/src/styles.css`.

Colours only through tokens, never raw hex — otherwise the dark theme breaks.
No `uppercase` or weight 900: the interface carries chat, diffs and logs, so the
styling has to stay out of the content's way.

## Talking to the user

The maintainer writes in Ukrainian and expects replies in Ukrainian. That applies
to conversation only — everything written into the repository stays English.

The maintainer does not know this stack: explain problems in plain language
rather than pasting tool output.

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
this editor included. Then wait until `pgrep` on that path comes back empty
before starting again: it takes a few seconds to exit, and a `sleep 2` was not
enough — the new copy lost the lock and the old build stayed on screen.
The packaged `/Applications/Octopus.app` holds the same lock: while it is open,
`npm run dev` builds, prints `DevTools listening` and exits 0 with no window.
It is the maintainer's working copy, so ask before quitting it.
Both go away with `OCTOPUS_DATA_DIR=/some/absolute/dir npm run dev`: a copy with
a data root of its own is not the same app to either lock, and it starts empty.
The Scripts tab's Run sets it (`.octopus/scripts/run.sh`), so this trap is for a
bare `npm run dev` only.

**An agent run by a dev copy inherits its `ELECTRON_RENDERER_URL`.** A copy
it launches — a built app, a Playwright driver — then loads the _running_ dev
server's renderer: the main checkout's window over this worktree's core, every
change to `src/renderer` invisible and nothing reporting why. Strip the
`ELECTRON_*` variables from the environment of anything you launch.

**The running app holds the state in memory.** Editing `~/.octopus/state.json`
from the outside while it runs makes the two disagree, and the app will happily
act on its stale copy. Never reproduce a bug against the user's real state or
data root: point the service at a temporary directory instead. A repro that
corrupts the thing being diagnosed is worse than no repro.

The `electron` package's `postinstall` sometimes fails silently to download the
binary. In a fresh worktree it may not run at all: npm's `allow-scripts` holds
install scripts back (the `npm warn allow-scripts` lines at the end of
`npm install`), and that skips `node-pty`'s build as well. Run both commands
below and the one under "Native modules". Symptom: the build succeeds and then
`npm run dev` fails with `Error: Electron uninstall`, or with
`spawn .../Electron.app/... ENOENT` when `dist/` survived holding only `LICENSE`
and `version` — so check for the app itself, not the directory.

```bash
ls node_modules/electron/dist/Electron.app   # must exist
node node_modules/electron/install.js
```

## Out of scope for now

Monaco diff, notifications, Linux builds, auth service.

Pull requests are not: the right pane runs the whole loop through `gh` —
committing, opening, the checks, the review, answering and settling a review
thread, six prepared prompts and merging (§12.4 of docs/PROJECT.md).

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

**The build cannot be dropped in favour of the shipped prebuilds, and the reason
is not the ABI.** `node-pty` ships `prebuilds/darwin-arm64/`, and its resolver
falls back to it — so removing `postinstall` looks like free speed. Measured:
`pty.node` from the prebuild loads perfectly, and then `pty.fork` fails with
`posix_spawnp failed`. The `spawn-helper` beside it is `-rw-r--r--` where the
built one is `-rwxr-xr-x`; npm does not preserve the executable bit, and
`chmod +x` on it makes the same spawn succeed. So the thing `postinstall` is
really buying is a `spawn-helper` that can be executed.

`posix_spawnp failed` is therefore the symptom that means "the build did not
run", and the fix is the command above.
