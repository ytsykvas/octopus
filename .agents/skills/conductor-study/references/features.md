# Conductor: what it has

_As of Conductor 0.91.0, docs fetched 2026-10-19. Everything here is **documented**
unless marked otherwise._

Conductor is a Mac-only app for running coding agents in parallel, each in an isolated
workspace. The shell is **Tauri 2**
(Rust, the system WebKit view) around a React interface, with the logic in a
Bun-compiled TypeScript runtime — **observed** from `otool -L` and `strings` on the
binaries (see `mechanisms.md`). The local app is free; Cloud, Multiplayer, the API and
the mobile app sit in a **Pro** plan ($50/month), with **Teams** ($60/user/month) and
Enterprise above it. (The FAQ still says Conductor makes no money yet; the pricing page
is the newer of the two.)

## The model

| Term                | Meaning                                                                           |
| ------------------- | --------------------------------------------------------------------------------- |
| Project             | The app's entry for one codebase: settings, scripts, instructions, workspace list |
| Repository          | The git codebase behind a project (local folder, GitHub, or Quick start)          |
| Workspace           | One isolated copy for one task — 1 workspace ↔ 1 branch                           |
| Branch              | The review and PR unit                                                            |
| Working tree        | The files on disk, created as a git worktree                                      |
| Running environment | App, server, watchers, tests running inside the workspace                         |

Workspaces live at `~/conductor/workspaces/<repo>/<workspace>`. App data lives at
`~/Library/Application Support/com.conductor.app`; user config at `~/.conductor`.
Isolation is explicitly called "development isolation, not a security boundary" —
agents run unsandboxed with the user's own permissions.

## Workspace lifecycle

- **Creation** from: a fresh branch, an existing branch, a PR, a GitHub issue, or a
  Linear issue. `⌘⇧N` opens the picker; `⌘N` creates directly.
- New branches are based on the configured base branch, and Conductor **fetches from
  `origin` first**, so a workspace starts from the latest remote commit even when the
  local checkout is stale. The fetch deliberately does not move the branch checked out
  in the root directory.
- On first chat, Conductor **instructs the agent to rename the branch** to match the
  work. Branch-rename guidance is configurable per repository.
- **One branch, one workspace** — the plain git worktree constraint, surfaced in the UI
  with suggested workarounds.
- **Archiving** removes the worktree but keeps chat history; archived workspaces are
  restorable from a History pane. Repo settings can archive on merge
  (`git.archive_on_merge`) and delete the branch on archive
  (`git.delete_branch_on_archive`); a branch prefix is configurable too.
- **`.context`** — a gitignored folder in each workspace for notes, specs and
  handoffs that should reach the agent without being committed.

## Naming: cities

Every workspace gets a city name — 295 of them. The city is the _directory_ name and
stays stable so tools keep finding the same path; the branch name or PR title is what
identifies the workspace in the sidebar. Repeats get a `-v2` / `-v3` suffix (observed
in `~/.conductor/projects`: `bogota-v1`, `karachi-v1`). When every spawned workspace
stays active, Conductor avoids cities already in use. `⌘K → Passport` shows the cities
visited, as a travel log.

## Agents (harnesses)

Claude Code, Codex, Cursor Agent, and OpenCode. Claude Code and Codex ship **bundled**
(symlinked into `~/Library/Application Support/com.conductor.app/bin`; on this machine
Claude Code 2.1.300 and Codex 0.162.1 — **observed**) so Conductor controls the
version. OpenCode is a "managed" executable: the runtime downloads a pinned OpenCode
CLI from npm and drives it as `opencode acp` (**observed**). The harness overview page
still calls all three bundled; the FAQ names only Claude Code and Codex, which matches
the disk. Cursor runs through the Cursor API with a key (Composer 2.5); there is no
Cursor executable.

Any of the three executables can be swapped for the system one — `Settings → Storage`,
or `claude_code_executable_path` / `codex_executable_path` / `opencode_executable_path`
in settings.

Auth reuses whatever is already on the machine — a Claude Pro/Max subscription, an API
key, or provider env vars — and each harness has a CLI-auth or API-key mode under
`Settings → Harnesses`. Conductor does not resell model usage.

Each chat tab is one harness plus one model. Multiple chats in one workspace share the
branch and file state; separate workspaces get separate branches.

### Session controls

- **Plan Mode** — plan before editing.
- **Fast Mode** — speed over care, for extra credits where the model supports it.
- **Thinking/reasoning level** — per model.
- **Codex personality** — a working style, session-level.
- **Codex goals** (`/goal`) — a standing objective pursued across turns, with a goal
  bar showing status and token budget; pause/resume/edit/clear. Local workspaces only.
- **Skills** — repo and user skills work across Codex, Claude Code and OpenCode.
- **Checkpoints** — revert code _and_ chat to an earlier turn (see `mechanisms.md`).

### Injected prompts

Conductor injects system prompts telling the agent it is in Conductor, what a workspace
is, and more; plus prompts triggered by UI actions (creating a workspace, clicking
Create PR). These are visible and editable at Settings → repository → Preferences.

It also ships a **Claude Code plugin skill** at
`Contents/Resources/conductor-skill/skills/conductor/SKILL.md` (174 lines, marked
`license: Proprietary`) covering settings files, scripts, files-to-copy, agent controls
and review. It instructs the agent to branch on `CONDUCTOR_IS_LOCAL`, and to prefer
Conductor's own `DiffComment` tool — whose comments land in the Checks panel — over
posting to GitHub. The runtime loads it into Claude sessions as an Agent SDK plugin
(**observed**, `mechanisms.md`).

**octopus does not do this** (§2, §4): no system prompt and no bundled skill. Its
pull request pane does send prepared prompts on a click, but as visible user
messages in the chat, never behind the log. Worth knowing precisely, because the
objection is to _hidden_ injection — and Conductor's is documented and editable,
which is a weaker target than "opaque".

Note what is **not** the objection: reading the repository's `AGENTS.md`,
`CLAUDE.md` and `.claude/commands` is the user's own material and octopus loads all
of it, as the CLI does. Until 2026-08-19 it did not, and that was a mistake made in
this file's name.

### Repository instruction slots

`General preferences`, `Code review preferences`, `Create PR preferences`, `Fix errors
preferences`, `Resolve conflicts preferences`, `Branch rename preferences` — each fires
on its matching action, and each is a `prompts.*` key in repo settings (`general`,
`code_review`, `create_pr`, `fix_errors`, `resolve_merge_conflicts`, `rename_branch`).
Plus the usual `AGENTS.md`, `CLAUDE.md`, `.claude/commands` and skills.

## Scripts and environment

Three script types, all run from the workspace directory in **non-interactive zsh**
(bash in cloud):

| Script             | Runs                           |
| ------------------ | ------------------------------ |
| `scripts.setup`    | After the workspace is created |
| `scripts.run.<id>` | On the Run button              |
| `scripts.archive`  | Before archiving               |

Run scripts are named and structured: `command`, `args`, `options.cwd`, `default`,
`icon` (a Lucide name, invalid ones fall back to `play`), `hide`, `available_in`
(`local` / `cloud`). The id is what matches one script across the settings layers, so a
local layer can `hide` a shared script. `run_mode` is `concurrent` or `nonconcurrent` —
the latter stops any other run script first, for projects tied to a fixed port, one
database or one Docker stack. (The published repo schema forbids unknown run-script
keys and does not list `hide`; the docs do. Trust the docs, check the app if it
matters.) The schema also carries `scripts.auto_run_after_setup` — start the run script
once a new local workspace finishes setup — which no docs page mentions yet.

**Ports:** each local workspace gets ten, `CONDUCTOR_PORT` through `CONDUCTOR_PORT+9`.
`preview_urls` in repo settings feeds the terminal panel's Open button; it expands
`$CONDUCTOR_PORT` and `$((CONDUCTOR_PORT + n))`, nothing else.

**Env vars:** `CONDUCTOR_WORKSPACE_NAME` (falls back to the directory name locally),
`_PATH`, `CONDUCTOR_ROOT_PATH`, `CONDUCTOR_DEFAULT_BRANCH`, `CONDUCTOR_PORT`,
`CONDUCTOR_IS_LOCAL`, `CONDUCTOR_SESSION_ID` (agent processes only, not setup scripts or
terminals); the bundled skill adds `CONDUCTOR_WORKSPACE_ID` for agent and terminal
processes. Cloud-only: `CONDUCTOR_BASE_DIR`, `_API_URL`, `_API_TOKEN`, `_API_KEY`. Repo
settings add `[environment_variables]`, with `.local` and `.cloud` sub-tables.

**Process handling and shell capture:** Stop is `SIGTERM` to the process group, five
fixed seconds, then `SIGKILL` to the group; the environment comes from an interactive
login shell with a five-second budget. Details in `mechanisms.md`, "Process lifecycle"
and "Shell environment capture".

## Files to copy

Git worktrees start from tracked files only, so gitignored local files (`.env.local`,
certs, local config) are missing. Conductor copies them from the main checkout when a
local workspace is created, selecting only files git already ignores — a tracked file
is already there, an untracked-but-not-ignored one is not eligible. Resolution order,
first source that exists wins: `.worktreeinclude` at repo root → `file_include_globs` in
repo settings → default `.env*`. Either custom source **replaces** the default, so
`.env*` has to be listed again to keep it; and while `.worktreeinclude` exists the
settings field becomes a read-only preview. `.gitignore` pattern syntax, evaluated from
the repo root (negation, `**`, a leading `/` to anchor). Claude Code reads the same
`.worktreeinclude` for its own worktrees. Local workspaces only. Static files go here;
anything that needs a command — installs, generated files, symlinks — belongs in the
setup script.

(The published schema describes `file_include_globs` as patterns "surfaced in the
workspace file picker", which does not match any docs page. The docs are consistent
across four pages and the bundled skill; the schema text looks stale.)

## Settings

Four layers, TOML, precedence **managed > repo-local > repo-shared > user > defaults**;
any TOML beats any legacy JSON:

1. `<repo>/.conductor/settings.local.toml` — this machine, this repo
2. `<repo>/.conductor/settings.toml` — shared, committed; the Mac app reads it **from
   the default branch on the remote**, so it must be merged before it takes effect
3. `~/.conductor/settings.toml` — this user, all repos
4. `~/.conductor/settings.managed.toml` — organisation-controlled, disables the matching
   UI controls

Legacy `conductor.json` is ignored once `.conductor/settings.toml` exists (cloud setup
still falls back to its setup script). Not repo-configurable: model defaults, reasoning
defaults, tool approvals (`tool_approvals_enabled`), default workspace location — a repo
file that sets them is ignored, and a repo file with a key outside its schema is
rejected. Unknown keys in the managed file are ignored instead.

## Review and merge

- **Diff viewer** (`⌘⇧D`) — file list, unified or split, filter by commit, inline
  comments that become composer attachments sent back to the agent. GitHub review
  comments surface here too and can be resolved here; files can be reverted.
- **Checks tab** — git status, PR metadata, CI and status checks, deployments, GitHub
  comments and review threads, todos. Conductor may **block merge** on unresolved todos
  or failed checks.
- **Todos** — merge-blocking work items; agents can write them; `@todos` sends the list
  to the agent.
- **Review action** — an agent review driven by the repository's review preferences.
- **PR flow** — `⌘⇧P` creates a PR; Conductor drafts descriptions, responds to review
  comments, fixes failing checks, then merge and archive.
- Conductor bundles its own `gh` binary (40 MB, gh 2.100.0) rather than relying on the
  user's.

## Testing

- **Run scripts** — per workspace, own ports, the default path.
- **Spotlight testing** — for projects that must run from the repository root: syncs one
  workspace's tracked changes back into the root and runs there. One workspace at a
  time; switching it to another workspace swaps the root over, and turning it off
  restores the root's original state. Enabled per repo (`spotlight_testing = true`).
  See `mechanisms.md` for how.

## Other surfaces

- **Big Terminal Mode** (`⌘⇧T`, behind Settings → Experimental) — a full terminal
  replacing the centre panel, sessions restoring after restart, with presets that launch
  agents. The Claude and Codex presets follow the tool-approval setting: with approvals
  off they start in full-access mode (`claude --dangerously-skip-permissions`, Codex
  with `--sandbox danger-full-access`), with approvals on they use the CLI defaults.
  The rest are fixed: `opencode`, `amp`, `pi`, `copilot --allow-all`, `gemini -y`.
- **Deep links** — `conductor://prompt=…&path=…&branch=…` opens the new-workspace
  composer prefilled (the user still clicks Create; `branch` needs `path`);
  `conductor://linear_id=…` creates or reopens the workspace for a Linear issue;
  `conductor://async?repo=…&plan=<base64>` creates one with a plan attached.
- **Monorepos** — pick working directories per workspace; the rest is hidden via
  `git sparse-checkout`; changeable later from the git panel.
- **Linking multiple directories** — `/add-dir` in one workspace links other
  workspaces so its agent can read and edit across repos.
- **MCP** — no Conductor-specific format; it uses whatever Claude Code / Codex / Cursor
  load. Status for Claude Code and Codex in the composer (plug icon, refresh, OAuth
  sign-in from the status row) and via `/mcp-status`; Cursor's is not surfaced.
- **Slash commands** — plain `.claude/commands/*.md`.
- **Repo icon** — probed from 17 conventional paths in the repo (`public/apple-touch-icon.png`,
  `favicon.svg`, `src-tauri/icons/icon.png`, …), first match wins.
- **Enterprise data privacy** — a local-only switch disabling everything needing an
  external AI provider (AI chat titles, custom MCP servers), settable per user or per
  repo; either one turns it on.

## Cloud and team — all outside octopus's scope

Recorded for completeness; §5 rules these out as non-goals. Pro plan and above.

Cloud workspaces run in Vercel Sandbox microVMs (8 vCPU, 16 GB, 32 GB NVMe, Amazon
Linux 2023, `us-east-1`), sleeping after 4 h idle with a 23 h 50 m hard lifetime. An
organisation shares one **Cloud Computer** — repos, env vars, secrets, an install
script — rebuilt on demand, configurable by an agent in an Admin workspace.
**Multiplayer** gives shared workspaces and chats, presence dots, following, `Reassign
to`, and shareable links. There is a public **Conductor API** (beta) with **routines**
— a saved prompt run in a fresh workspace on a webhook, cron or GitHub trigger — a
hosted **MCP server** for driving cloud workspaces from other clients, a Slack
connector, an iOS app, and `RunLocalCommand` letting a cloud agent run one command back
on the user's Mac.

Local chats stay on-device and never reach Conductor's servers; cloud chats necessarily
do. Analytics go to PostHog either way. (The docs no longer say where account data is
hosted, only that it is encrypted.)
