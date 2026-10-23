# Conductor against octopus

_Every row re-checked against `src/` on 2026-10-19. Re-check the code before relying on a
row — this file goes stale from our side, not Conductor's._

## Why octopus exists at all

Two complaints, recorded in §2, and only the first really matters:

1. **Material injected into agent instructions that we never wrote.** Conductor injects
   system prompts about workspaces, plus action-triggered prompts, plus a bundled
   proprietary skill. octopus's answer is that it injects **none of those** — no
   system-prompt text of its own, no bundled skill. The prose it does send is the
   pull request pane's prepared prompts, which go as visible user messages, and the
   drafting request for a title and description, whose answer lands in the form for
   the person to read before anything is published. The pull request instruction they
   carry is the project's own, editable in its settings (§12.4).

   It is **not** that octopus withholds the user's own instructions. It once did —
   `settingSources: []` — and that was withdrawn on 2026-08-19: the default is now the
   CLI's full set, so `CLAUDE.md`, commands, skills and subagents all load. The switch
   in `SettingSourcesModeSchema` survives for anyone wanting isolation.

2. **An imposed order of steps.** No step in octopus is mandatory: a workspace can be
   created and abandoned, work can happen without a PR.

A suggestion that octopus should add context of its own — a system prompt, a bundled
skill, prose slipped in behind the log — still violates the principle. Flag it. A
suggestion that the agent should read more of what the **user** wrote is the opposite
and is welcome: withholding that was the mistake this file used to defend.

## Declared non-goals — never propose these

From §5 and §12.3. These are decisions, not gaps:

- **Other agents.** Claude Code only. No Codex, Cursor, OpenCode, Gemini, Amp.
- **Cloud execution.** Everything is local, there is no backend.
- **Teams, multiplayer, sharing, presence, an API, a mobile app.**
- **Accounts and authentication** — not scope, and no longer a reserved hook either.
- Not an IDE or terminal replacement; not for the App Store.

Roughly half of Conductor's surface area lives here. Saying "non-goal" is a complete
answer.

## The delta

| Conductor                                                  | octopus                                                                                                                                                                                                                                                                                                                                                   | Where                                                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Worktree per workspace, own branch                         | **Same** — `<prefix>/<name>` cut from the base branch                                                                                                                                                                                                                                                                                                     | `workspaces.ts` (`createWorkspace`, `branchFor`), `worktree.ts` (`addWorktree`)                        |
| Fetch `origin` before branching off base                   | **Same** — fetches the base's remote (whichever it is, not assumed `origin`) and branches from the remote-tracking ref                                                                                                                                                                                                                                    | `workspaces.ts` (`freshBase`), `remotes.ts` (`resolveBase`, `fetchRemote`)                             |
| Workspace named from a stable pool, `-v2` on repeat        | **Same shape**, different pool: given names picked at random, `-2`, `-3` once the pool is used up                                                                                                                                                                                                                                                         | `names.ts` (`nextWorkspaceName`)                                                                       |
| Branch is the primary label, directory name secondary      | **Same** (§10.8) — the row shows the workspace name, which is the branch's last segment and moves with it; the full branch is the tooltip, the directory is never shown                                                                                                                                                                                   | `WorkspaceRow.tsx`, `workspaces.ts` (`branchFor`)                                                      |
| Agent renames the branch on first chat                     | **Different on purpose** — no prompt, that would be injection. Renaming the workspace renames its branch, as a user action                                                                                                                                                                                                                                | `workspaces.ts` (`renameWorkspace`), `worktree.ts` (`renameBranch`)                                    |
| Setup / run / archive scripts                              | **Same**, `.octopus/scripts/setup.sh`, `run.sh`, `archive.sh` in the repo, Project settings as the fallback. Different: `setup.sh` runs as the first half of Run, not on creation, and a repo's script runs only once approved                                                                                                                            | `scripts.ts`, `repoSource.ts` (`resolveScript`), `archive.ts`, `ProjectSettings.tsx`                   |
| Ten ports per workspace, `CONDUCTOR_PORT`..+9              | **Same** — a block of ten from a pool, `OCTOPUS_PORT` and `OCTOPUS_PORT_1`…`_9`, handed to the run script and to the conversation's session                                                                                                                                                                                                               | `scriptEnv.ts` (`BLOCK`, `scriptEnv`), `ports.ts`                                                      |
| `run_mode` concurrent / nonconcurrent                      | **Missing** — always concurrent: one runner per workspace, each on its own ports, nothing stops another workspace's server                                                                                                                                                                                                                                | `WorkspaceScripts.tsx`                                                                                 |
| Named run scripts with icons, `available_in`, `default`    | **Missing** — one `run.sh` per project; the script kinds are a fixed enum of three                                                                                                                                                                                                                                                                        | `scripts.ts` (`ScriptKindSchema`, `SCRIPT_FILES`)                                                      |
| Settings in 4 TOML layers, repo-committed, JSON schemas    | **Partial** — JSON: the repo's `.octopus/` (scripts, instructions, base branch, env file) read live, then the project's settings, per-item "use mine instead"; the carry list is the project's, plus — for a trusted repository — the lines of its `.octopus/carry` that git ignores, read live; global `config.json`; no machine-local or managed tier   | `sourceItems.ts`, `repoSource.ts`, `projectFields.ts`, `repoConfig.ts`                                 |
| Files to copy / `.worktreeinclude` for gitignored files    | **Same intent** — the carry list: exact paths (no globs), default `.env`, an optional `= source` for a checkout that lacks the file; copied at creation and before a run, never over an existing file; a trusted repository's `.octopus/carry` adds paths, never sources; the allow rules of a carried `settings.local.json` stay out of the trust digest | `carry.ts` (`carriedFiles`, `carryInto`), `ProjectSettings.tsx`                                        |
| Checkpoints via private git refs, per agent turn           | **Present, built differently** — rewind (conversation, files or both) and fork through the Agent SDK (`rewindFiles`, `forkSession`), not Conductor's git plumbing                                                                                                                                                                                         | `rewind.ts`, `agent.ts` (`rewindFiles`), `chats.ts` (`forkChat`), `service.ts` (`rewindChat`)          |
| Spotlight testing (sync workspace → repo root)             | **Missing**                                                                                                                                                                                                                                                                                                                                               | —                                                                                                      |
| Diff viewer with inline comments → composer attachments    | **Present** — unified or split, notes on a line or a dragged range sent with the next message, per-file revert; no per-commit filter, and GitHub review threads live in the pull request tab. Monaco diff is out of scope (§15)                                                                                                                           | `diff/DiffPanel.tsx`, `useDiffComments.ts`, `diff.ts`, `revert.ts`                                     |
| Checks tab: git status, CI, deployments, PR comments       | **Partial** — no tab of its own: the Pull request tab holds CI checks and review threads (reply, resolve, add to chat), the Changes tab shows pushed / committed / uncommitted; no deployments                                                                                                                                                            | `pr/PullRequestPanel.tsx`, `pr/ChecksList.tsx`, `pr/CommentList.tsx`                                   |
| Todos, merge-blocking                                      | **Partial** — the agent's own list (`TodoWrite`, `TaskCreate` / `TaskUpdate`) is drawn while it works; **merge-blocking todos are missing**, merge follows GitHub's merge state                                                                                                                                                                           | `todos.ts`, `TodoPanel.tsx`                                                                            |
| PR creation, description drafting, merge                   | **Present** — the right pane runs the loop through `gh` (§12.4): commit, push, open with an agent-drafted title and body, merge, close                                                                                                                                                                                                                    | `pr/`, `pullRequests.ts`, `pullRequestDraft.ts`                                                        |
| Bundles its own `gh`, `watchexec`, Claude Code, Codex      | **Partial** — Claude Code is the CLI that ships with the Agent SDK, packed inside the app; `gh` and `git` are the machine's own                                                                                                                                                                                                                           | `agentBinary.ts`, `electron-builder.yml` (`asarUnpack`)                                                |
| Embedded terminal                                          | **Present** — `node-pty` + xterm, one shell per workspace that survives switching                                                                                                                                                                                                                                                                         | `terminal.ts`, `main/terminals.ts`, `Terminal.tsx`, `WorkspaceTerminals.tsx`                           |
| Several chats per workspace, session per chat              | **Same design** — up to three open per workspace, session id on the chat (§12.3)                                                                                                                                                                                                                                                                          | `chats.ts` (`MAX_CHATS_PER_WORKSPACE`), `agent.ts`                                                     |
| Session resume across restarts                             | **Same**                                                                                                                                                                                                                                                                                                                                                  | `agent.ts` (`resume`), `chats.ts` (`sessionId`)                                                        |
| Plan / Fast mode, reasoning level                          | **Partial** — plan mode beside a working mode (`default` / `acceptEdits`, no bypass), effort `low`…`max` plus `ultracode`, a model per chat; no Fast mode                                                                                                                                                                                                 | `chats.ts`, `EffortPicker.tsx`, `ModelPicker.tsx`                                                      |
| Per-repo instruction slots (review, PR, conflicts, rename) | **Present** — seven prepared prompts as files (pull request, commit message, fix checks, address review, review, multi-agent review, resolve conflicts), resolved repo → project → installation → template; the chat ones go as a visible user message, the PR draft as a background read-only query. No rename slot                                      | `instructions.ts` (`effectiveInstruction`), `repoSource.ts` (`repoInstruction`), `pullRequestDraft.ts` |
| Archive with restorable history                            | **Partial** — a closed conversation is kept, transcript included, and reopens; removing a workspace deletes its record and transcripts, and its branch unless unticked, with no restore; workspace archiving is out of scope (§15)                                                                                                                        | `service.ts` (`closeChat`, `reopenChat`, `removeWorkspaceById`), `chats.ts`                            |
| Repo icon probed from 17 paths in the repo                 | **Different on purpose** — chosen in project settings from a fixed set, plus a colour and initials                                                                                                                                                                                                                                                        | `icons.ts`, `colors.ts`, `initials.ts`                                                                 |
| Monorepo working-directory selection via sparse-checkout   | **Missing** — choosing a subdirectory binds the project to the repository root                                                                                                                                                                                                                                                                            | `git.ts` (`findRepositoryRoot`)                                                                        |
| MCP status surfaced in the composer                        | **Missing** — MCP servers load (a repo's `.mcp.json` once trusted) and their questions are answered in the log, but no status or refresh                                                                                                                                                                                                                  | `elicitation.ts`, `ElicitationCard.tsx`                                                                |
| Deep links (`conductor://`)                                | **Missing** — no URL scheme registered                                                                                                                                                                                                                                                                                                                    | —                                                                                                      |
| Slash commands from `.claude/commands`                     | **Present** — the composer suggests the session's own command list                                                                                                                                                                                                                                                                                        | `useCommands.ts`, `SuggestionMenu.tsx`                                                                 |
| Big Terminal Mode                                          | **Different** — the terminal is a right-pane tab; the centre holds chat and file tabs only                                                                                                                                                                                                                                                                | `WorkspaceTerminals.tsx`, `RightPanel.tsx`                                                             |
| Workspace creation from GitHub / Linear issue              | **Missing** — a workspace is always a new branch off the base; issue sources are an open question (§16)                                                                                                                                                                                                                                                   | `main/ipc.ts` (`workspaces:create` takes a project id only)                                            |
| Sidebar tree: repos + workspaces together                  | **Different on purpose** — project tab strip + workspace pane (§10.8)                                                                                                                                                                                                                                                                                     | `ProjectTabs.tsx`, `Sidebar.tsx`                                                                       |
| Cloud, Multiplayer, API, iOS                               | **Non-goal**                                                                                                                                                                                                                                                                                                                                              | —                                                                                                      |

## Where octopus is deliberately different

Do not "fix" these toward Conductor:

- **Nothing implicit reaches the agent.** The whole point (§4).
- **One data root.** Everything under `~/.octopus/`; Conductor spreads across
  `~/conductor`, `~/.conductor` and `~/Library/Application Support/com.conductor.app`
  (octopus's layout is §12.5).
- **The layout's structure is copied; the visual style is not** (§10.8, §10). Neutral
  base, 1px separators, no uppercase, no weight 900.
- **Claude Code only**, integrated directly through the Agent SDK rather than abstracted
  over four harnesses (§6).
- **Localised UI** with English as the source of truth (§10.9). Conductor is
  English-only.
- **100% coverage everywhere**, renderer included, enforced by one threshold both
  configs share (`vitest.shared.ts`).
- **No session cost in dollars beside a workspace** (§16) — a deliberate rejection, and a
  good example of octopus declining a feature on principle rather than for lack of time.
  The one place the figure appears is the card `/usage` draws, where it is the answer
  to the question asked.

## The uncomfortable one

This is worth remembering whenever a comparison drifts toward "should we sell this":
Conductor gives the local app away free and charges for cloud and teams. And Claude Code
now does worktrees natively (`EnterWorktree` / `ExitWorktree`). That comparison is what
ended the question — octopus is MIT-licensed and built from source, and PROJECT.md §5
records why. Its case is that it is a personal tool built the way its author wants, which
is a complete answer, but only while nobody pretends it is a market position.
