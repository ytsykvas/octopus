# Conductor against octopus

_Rows re-checked against `src/` on 2026-10-14; those marked "not re-verified" date from
2026-08-12. Re-check the code before relying on a row — this file goes stale from our
side, not Conductor's._

## Why octopus exists at all

Two complaints, recorded in §2, and only the first really matters:

1. **Material injected into agent instructions that we never wrote.** Conductor injects
   system prompts about workspaces, plus action-triggered prompts, plus a bundled
   proprietary skill. octopus's answer is that it injects **none of those** — no
   system-prompt text of its own, no bundled skill, and the one piece of prose it
   sends (the pull request instruction) goes as a visible user message.

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

| Conductor                                                  | octopus                                                                                                                                                                                      | Where                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Worktree per workspace, own branch                         | **Same**                                                                                                                                                                                     | `worktree.ts`, `workspaces.ts`                 |
| Fetch `origin` before branching off base                   | **Same intent** — verify `detectBaseBranch` covers it (not re-verified)                                                                                                                      | `git.ts`                                       |
| Workspace named from a stable pool, `-v2` on repeat        | **Same shape**, different pool: given names, a numeric suffix once the pool is used up                                                                                                       | `names.ts`                                     |
| Branch is the primary label, directory name secondary      | **Same** (§10.8)                                                                                                                                                                             | `Sidebar.tsx`, `branches.ts`                   |
| Agent renames the branch on first chat                     | **Not as a prompt** — that would be injection. Renaming a branch is a user action                                                                                                            | `worktree.ts` (`renameBranch`)                 |
| Setup / run / archive scripts                              | **Same** — `.octopus/scripts/setup.sh`, `run.sh`, `archive.sh`, or Project settings as the fallback                                                                                          | `RepoConfig.tsx`, `ProjectSettings.tsx`        |
| Ten ports per workspace, `CONDUCTOR_PORT`..+9              | **Same** — `OCTOPUS_PORT` and `OCTOPUS_PORT_1`…`_9`                                                                                                                                          | `ScriptRunner.tsx`                             |
| `run_mode` concurrent / nonconcurrent                      | **Missing** — always concurrent                                                                                                                                                              | —                                              |
| Named run scripts with icons, `available_in`, `default`    | Single run script (not re-verified)                                                                                                                                                          | `scripts.ts`                                   |
| Settings in 4 TOML layers, repo-committed, JSON schemas    | `~/.octopus/config.json`, per-project settings, and a committed `.octopus/` directory (scripts, carry list, instructions); no layering and no managed tier                                   | `config.ts`, `persist.ts`                      |
| Files to copy / `.worktreeinclude` for gitignored files    | **Present** — the carry list, one path per line, with an optional `= source` for a checkout that lacks the file                                                                              | `ProjectSettings.tsx`, `RepoConfig.tsx`        |
| Checkpoints via private git refs, per agent turn           | **Present, built differently** — rewind and fork through the Agent SDK (`rewindFiles`, `forkSession`), not Conductor's git plumbing                                                          | `agent.ts`, `service.ts`                       |
| Spotlight testing (sync workspace → repo root)             | **Missing**                                                                                                                                                                                  | —                                              |
| Diff viewer with inline comments → composer attachments    | **Present** — changed files with inline comments sent back to the agent; Monaco diff is out of scope (§15)                                                                                   | `RightPanel.tsx`, `useDiffComments.ts`         |
| Checks tab: git status, CI, deployments, PR comments       | **Present** in the pull request panel: CI checks, comments and review threads                                                                                                                | `pr/PullRequestPanel.tsx`, `pr/ChecksList.tsx` |
| Todos, merge-blocking                                      | The agent's own todo list is drawn while it works; **merge-blocking todos are missing**                                                                                                      | `TodoPanel.tsx`, `todos.ts`                    |
| PR creation, description drafting, merge                   | **Present** — the right pane runs the loop through `gh` (§12.4)                                                                                                                              | `pr/`, `instructions.ts`                       |
| Bundles its own `gh`, `watchexec`, Claude Code, Codex      | Uses what is on the machine                                                                                                                                                                  | —                                              |
| Embedded terminal                                          | **Present** — `node-pty` + xterm                                                                                                                                                             | `terminal.ts`, `Terminal.tsx`                  |
| Several chats per workspace, session per chat              | **Same design** — session id lives on the chat (§12.3)                                                                                                                                       | `chats.ts`, `agent.ts`                         |
| Session resume across restarts                             | **Same**                                                                                                                                                                                     | `agent.ts`                                     |
| Plan / Fast mode, reasoning level                          | Plan mode, permission modes and effort exist; the set is not Conductor's                                                                                                                     | `chats.ts`                                     |
| Per-repo instruction slots (review, PR, conflicts, rename) | **Present** — seven prepared prompts as files (pull request, commit message, fix checks, address review, review, multi-agent review, resolve conflicts), each sent as a visible user message | `instructions.ts`                              |
| Archive with restorable history                            | Closed conversations can be reopened; restoring a removed workspace is not re-verified                                                                                                       | `service.ts` (`reopenChat`)                    |
| Repo icon probed from 17 paths in the repo                 | Chosen explicitly in project settings, plus a colour and initials                                                                                                                            | `icons.ts`, `colors.ts`, `initials.ts`         |
| Monorepo working-directory selection via sparse-checkout   | **Missing**                                                                                                                                                                                  | —                                              |
| MCP status surfaced in the composer                        | **Missing**                                                                                                                                                                                  | —                                              |
| Deep links (`conductor://`)                                | **Missing**                                                                                                                                                                                  | —                                              |
| Slash commands from `.claude/commands`                     | **Present** — the composer suggests the session's own command list                                                                                                                           | `useCommands.ts`, `ChatSession.tsx`            |
| Big Terminal Mode                                          | Terminal is a pane, not a centre-panel mode                                                                                                                                                  | `WorkspaceTerminals.tsx`                       |
| Workspace creation from GitHub / Linear issue              | **Open question** (§16), not re-verified                                                                                                                                                     | —                                              |
| Sidebar tree: repos + workspaces together                  | **Deliberately different** — project tab strip + workspace pane (§10.8)                                                                                                                      | `ProjectTabs.tsx`, `Sidebar.tsx`               |
| Cloud, Multiplayer, API, iOS                               | **Non-goal**                                                                                                                                                                                 | —                                              |

## Where octopus is deliberately different

Do not "fix" these toward Conductor:

- **Nothing implicit reaches the agent.** The whole point (§4).
- **One data root.** Everything under `~/.octopus/`; Conductor spreads across
  `~/conductor`, `~/.conductor` and `~/Library/Application Support/com.conductor.app`
  (§12.4 calls this out by name).
- **The layout's structure is copied; the visual style is not** (§10.8, §10). Neutral
  base, 1px separators, no uppercase, no weight 900.
- **Claude Code only**, integrated directly through the Agent SDK rather than abstracted
  over four harnesses (§6).
- **Localised UI** with English as the source of truth (§10.9). Conductor is
  English-only.
- **100% coverage in `core/`**, enforced (§11.3).
- **No session cost in dollars** (§16) — a deliberate rejection, and a good example of
  octopus declining a feature on principle rather than for lack of time.

## The uncomfortable one

This is worth remembering whenever a comparison drifts toward "should we sell this":
Conductor gives the local app away free and charges for cloud and teams. And Claude Code
now does worktrees natively (`EnterWorktree` / `ExitWorktree`). That comparison is what
ended the question — octopus is MIT-licensed and built from source, and PROJECT.md §5
records why. Its case is that it is a personal tool built the way its author wants, which
is a complete answer, but only while nobody pretends it is a market position.
