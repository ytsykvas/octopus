# Conductor against octopus

_Verified against `src/core/` on 2026-08-12. Re-check the code before relying on a row —
this file goes stale from our side, not Conductor's._

## Why octopus exists at all

Two complaints, recorded in §2, and only the first really matters:

1. **Material injected into agent instructions that we never wrote.** Conductor injects
   system prompts about workspaces, plus action-triggered prompts, plus a bundled
   proprietary skill. octopus's answer is technical, not rhetorical:
   `settingSources: []` in the Agent SDK call (§12.3), with a config switch offering
   `none` / `project` / `all` — `SettingSourcesModeSchema` in `config.ts`.
2. **An imposed order of steps.** No step in octopus is mandatory: a workspace can be
   created and abandoned, work can happen without a PR.

Any suggestion that quietly adds implicit context to the agent violates the first
principle. Flag it rather than proposing it — that is the one place where "Conductor
does it" is an argument _against_.

## Declared non-goals — never propose these

From §5 and §12.3. These are decisions, not gaps:

- **Other agents.** Claude Code only. No Codex, Cursor, OpenCode, Gemini, Amp.
- **Cloud execution.** Everything is local, there is no backend.
- **Teams, multiplayer, sharing, presence, an API, a mobile app.**
- **Accounts and authentication** (§15 is a distant-future hook, not scope).
- Not an IDE or terminal replacement; not for the App Store.

Roughly half of Conductor's surface area lives here. Saying "non-goal" is a complete
answer.

## The delta

| Conductor                                                  | octopus                                                                                                                                                                         | Where                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Worktree per workspace, own branch                         | **Same**                                                                                                                                                                        | `worktree.ts`, `workspaces.ts`         |
| Fetch `origin` before branching off base                   | **Same intent** — verify `detectBaseBranch` covers it                                                                                                                           | `git.ts`                               |
| Workspace named from a stable pool, `-v2` on repeat        | **Same shape**, different pool: women's names, `-2` suffix                                                                                                                      | `names.ts`                             |
| Branch is the primary label, directory name secondary      | **Same** (§10.8)                                                                                                                                                                | `Sidebar.tsx`, `branches.ts`           |
| Agent renames the branch on first chat                     | **Not implemented** — and it is prompt injection, so it needs a transparent form if wanted                                                                                      | —                                      |
| Setup / run / archive scripts                              | Setup + run only, no archive hook — **and `setup.sh` is never actually invoked**: `createWorkspace` only calls `addWorktree`, contradicting §12.2                               | `scripts.ts`, `workspaces.ts:138`      |
| Ten ports per workspace, `CONDUCTOR_PORT`..+9              | **One** port, `OCTOPUS_PORT`, derived from workspace id                                                                                                                         | `scripts.ts`, `store.ts`               |
| `run_mode` concurrent / nonconcurrent                      | **Missing**                                                                                                                                                                     | —                                      |
| Named run scripts with icons, `available_in`, `default`    | Single run script                                                                                                                                                               | `scripts.ts`                           |
| Settings in 4 TOML layers, repo-committed, JSON schemas    | Single `~/.octopus/config.json`, zod-validated                                                                                                                                  | `config.ts`, `persist.ts`              |
| Files to copy / `.worktreeinclude` for gitignored files    | **Missing** — new worktrees have no `.env`                                                                                                                                      | —                                      |
| Checkpoints via private git refs, per agent turn           | **Missing** — but the Agent SDK already ships `enableFileCheckpointing`, `rewindFiles`, `forkSession`, `resumeSessionAt`; copying their git plumbing is probably the wrong move | `sdk.d.ts`; `agent.ts` drops `uuid`    |
| Spotlight testing (sync workspace → repo root)             | **Missing**                                                                                                                                                                     | —                                      |
| Diff viewer with inline comments → composer attachments    | Changed-files list only; Monaco diff is out of scope (§16); inline review comments are an open question (§17)                                                                   | `worktree.ts:changedFiles`             |
| Checks tab: git status, CI, deployments, PR comments       | **Missing**                                                                                                                                                                     | —                                      |
| Todos, merge-blocking                                      | **Missing**                                                                                                                                                                     | —                                      |
| PR creation, description drafting, merge                   | **Missing** — `github.ts` only lists and clones repos. §16 defers it                                                                                                            | `github.ts`                            |
| Bundles its own `gh`, `watchexec`, Claude Code, Codex      | Uses what is on the machine                                                                                                                                                     | —                                      |
| Embedded terminal                                          | **Present** — `node-pty` + xterm, arrived early (§16)                                                                                                                           | `terminal.ts`, `Terminal.tsx`          |
| Several chats per workspace, session per chat              | **Same design** — session id lives on the chat (§12.3)                                                                                                                          | `chats.ts`, `agent.ts`                 |
| Session resume across restarts                             | **Same**                                                                                                                                                                        | `agent.ts`                             |
| Plan / Fast mode, reasoning level                          | Permission modes exist; the mode set is not Conductor's                                                                                                                         | `chats.ts`                             |
| Per-repo instruction slots (review, PR, conflicts, rename) | One kind: `pullRequest`                                                                                                                                                         | `instructions.ts`                      |
| Archive with restorable history                            | **Missing** (§16)                                                                                                                                                               | —                                      |
| Repo icon probed from 17 paths in the repo                 | Chosen explicitly in project settings, plus a colour and initials                                                                                                               | `icons.ts`, `colors.ts`, `initials.ts` |
| Monorepo working-directory selection via sparse-checkout   | **Missing**                                                                                                                                                                     | —                                      |
| MCP status surfaced in the composer                        | **Missing**                                                                                                                                                                     | —                                      |
| Deep links (`conductor://`)                                | **Missing**                                                                                                                                                                     | —                                      |
| Slash commands from `.claude/commands`                     | **Missing**                                                                                                                                                                     | —                                      |
| Big Terminal Mode                                          | Terminal is a pane, not a centre-panel mode                                                                                                                                     | `WorkspaceTerminals.tsx`               |
| Workspace creation from GitHub / Linear issue              | **Open question** (§17)                                                                                                                                                         | —                                      |
| Sidebar tree: repos + workspaces together                  | **Deliberately different** — project tab strip + workspace pane (§10.8)                                                                                                         | `ProjectTabs.tsx`, `Sidebar.tsx`       |
| Cloud, Multiplayer, API, iOS                               | **Non-goal**                                                                                                                                                                    | —                                      |

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
- **No session cost in dollars** (§17) — a deliberate rejection, and a good example of
  octopus declining a feature on principle rather than for lack of time.

## The uncomfortable one

§15.6 is worth remembering whenever a comparison drifts toward "should we sell this":
Conductor gives the local app away free and charges for cloud and teams. And Claude Code
now does worktrees natively (`EnterWorktree` / `ExitWorktree`). octopus's case is that
it is a personal tool built the way its author wants — which is a complete answer, but
only while nobody pretends it is a market position.
