# Conductor: what it has

_As of Conductor 0.80.0, docs fetched 2026-08-12. Everything here is **documented**
unless marked otherwise._

Conductor is a Mac-only native app (Swift, judging by the Mach-O arm64 binary — that
part is **inferred**) for running coding agents in parallel, each in an isolated
workspace. It is free; the company monetises Cloud and team features.

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
  restorable from a History pane.

## Naming: cities

Every workspace gets a city name — 295 of them. The city is the _directory_ name and
stays stable so tools keep finding the same path; the branch name or PR title is what
identifies the workspace in the sidebar. Repeats get a `-v2` / `-v3` suffix (observed
in `~/.conductor/projects`: `bogota-v1`, `karachi-v1`). When every spawned workspace
stays active, Conductor avoids cities already in use. `⌘K → Passport` shows the cities
visited, as a travel log.

## Agents (harnesses)

Claude Code, Codex, Cursor Agent, and OpenCode. Claude Code, Codex and OpenCode ship
**bundled inside the app** (at `~/Library/Application Support/com.conductor.app/bin`)
so Conductor controls the version; Cursor runs through the Cursor API with a key.

Auth reuses whatever is already on the machine — a Claude Pro/Max subscription, an API
key, or provider env vars. Conductor does not resell model usage.

Each chat tab is one harness plus one model. Multiple chats in one workspace share the
branch and file state; separate workspaces get separate branches.

### Session controls

- **Plan Mode** — plan before editing.
- **Fast Mode** — speed over care.
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
`Contents/Resources/conductor-skill/skills/conductor/SKILL.md` (173 lines, marked
`license: Proprietary`) covering settings files, scripts, files-to-copy, agent controls
and review. It instructs the agent to branch on `CONDUCTOR_IS_LOCAL`, and to prefer
Conductor's own `DiffComment` tool over posting to GitHub.

**This is the practice octopus was built to reject** (§2, §4, §12.3
`settingSources: []`). Worth knowing precisely, because the objection is to _hidden_
injection — and Conductor's is documented and editable, which is a weaker target than
"opaque". The sharper complaint is that it is on by default.

### Repository instruction slots

`General preferences`, `Code review preferences`, `Create PR preferences`, `Fix errors
preferences`, `Resolve conflicts preferences`, `Branch rename preferences` — each fires
on its matching action. Plus the usual `AGENTS.md`, `CLAUDE.md`, `.claude/commands`.

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
(`local` / `cloud`). `run_mode` is `concurrent` or `nonconcurrent` — the latter for
projects tied to a fixed port, one database or one Docker stack.

**Ports:** each local workspace gets ten, `CONDUCTOR_PORT` through `CONDUCTOR_PORT+9`.

**Env vars:** `CONDUCTOR_WORKSPACE_NAME`, `_PATH`, `CONDUCTOR_ROOT_PATH`,
`CONDUCTOR_DEFAULT_BRANCH`, `CONDUCTOR_PORT`, `CONDUCTOR_IS_LOCAL`, plus cloud-only
`CONDUCTOR_BASE_DIR`, `_API_URL`, `_API_TOKEN`, `_API_KEY`, `_SESSION_ID`.

**Process handling:** stopping a script sends `SIGHUP`, waits 200 ms, then `SIGKILL`.
Docs warn against backgrounding with `&` and recommend `concurrently` so the process
group dies together.

**Shell capture:** Conductor launches an interactive login shell _in the workspace
directory_ (so `mise` and friends resolve correctly) to capture the environment, with a
**5-second timeout**; then runs commands under zsh.

## Files to copy

Git worktrees start from tracked files only, so gitignored local files (`.env.local`,
certs, local config) are missing. Conductor copies them in, selecting only files git
already ignores. Resolution order: `.worktreeinclude` at repo root → `file_include_globs`
in repo settings → default `.env*`. `.gitignore` pattern syntax. Local workspaces only.

## Settings

Four layers, TOML, precedence **managed > repo-local > repo-shared > user > defaults**;
any TOML beats any legacy JSON:

1. `<repo>/.conductor/settings.local.toml` — this machine, this repo
2. `<repo>/.conductor/settings.toml` — shared, committed; the Mac app reads it **from
   the default branch on the remote**, so it must be merged before it takes effect
3. `~/.conductor/settings.toml` — this user, all repos
4. `~/.conductor/settings.managed.toml` — organisation-controlled, disables the matching
   UI controls

Legacy `conductor.json` is ignored once `.conductor/settings.toml` exists. Not
repo-configurable: model defaults, reasoning defaults, tool approvals, default workspace
location.

## Review and merge

- **Diff viewer** (`⌘⇧D`) — file list, unified or split, filter by commit, inline
  comments that become composer attachments sent back to the agent. GitHub review
  comments surface here too.
- **Checks tab** — git status, PR metadata, CI and status checks, deployments, GitHub
  comments and review threads, todos. Conductor may **block merge** on unresolved todos
  or failed checks.
- **Todos** — merge-blocking work items; agents can write them; `@todos` sends the list
  to the agent.
- **Review action** — an agent review driven by the repository's review preferences.
- **PR flow** — `⌘⇧P` creates a PR; Conductor drafts descriptions, responds to review
  comments, fixes failing checks, then merge and archive.
- Conductor bundles its own `gh` binary (53 MB) rather than relying on the user's.

## Testing

- **Run scripts** — per workspace, own ports, the default path.
- **Spotlight testing** — for projects that must run from the repository root: syncs one
  workspace's tracked changes back into the root and runs there. One workspace at a
  time. See `mechanisms.md` for how.

## Other surfaces

- **Big Terminal Mode** (`⌘⇧T`, behind Settings → Experimental) — a full terminal
  replacing the centre panel, sessions restoring after restart, with presets that launch
  agents (`claude --dangerously-skip-permissions`, `codex …`, `opencode`, `amp`, `pi`,
  `copilot --allow-all`, `gemini -y`).
- **Deep links** — `conductor://prompt=…&path=…`, `conductor://linear_id=…`,
  `conductor://async?repo=…&plan=<base64>`.
- **Monorepos** — pick working directories per workspace; the rest is hidden via
  `git sparse-checkout`.
- **Linking multiple directories** — for microservices across repos.
- **MCP** — no Conductor-specific format; it uses whatever Claude Code / Codex / Cursor
  load. Shows status in the composer, with a refresh action.
- **Slash commands** — plain `.claude/commands/*.md`.
- **Repo icon** — probed from 17 conventional paths in the repo (`public/apple-touch-icon.png`,
  `favicon.svg`, `src-tauri/icons/icon.png`, …), first match wins.
- **Enterprise data privacy** — a switch disabling everything needing an external AI
  provider (AI chat titles, custom MCP servers), settable per user or per repo.

## Cloud and team — all outside octopus's scope

Recorded for completeness; §5 rules these out as non-goals.

Cloud workspaces run in Vercel Sandbox microVMs (8 vCPU, 16 GB, 32 GB NVMe, Amazon
Linux 2023, `us-east-1`), sleeping after 4 h idle with a 23 h 50 m hard lifetime. An
organisation shares one **Cloud Computer** — repos, env vars, secrets, an install
script — rebuilt on demand, configurable by an agent in an Admin workspace.
**Multiplayer** gives shared workspaces and chats, presence dots, following, `Reassign
to`, and shareable links. There is a public **Conductor API**, an iOS app, and
`RunLocalCommand` letting a cloud agent run one command back on the user's Mac.

Local chats stay on-device and never reach Conductor's servers; cloud chats necessarily
do. Analytics go to PostHog either way; account data sits in a Fly Postgres.
