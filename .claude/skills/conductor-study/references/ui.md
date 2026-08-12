# Conductor: the interface

_As of Conductor 0.80.0. **Documented** unless marked. Conductor's docs are text-heavy
and their screenshots are not in `llms-full.txt`, so parts of the layout are assembled
from prose — where that gets thin, the user has the app open and can just look._

octopus copied the **structure of this space** deliberately, and rejected the visual
style just as deliberately (§10.8, §10). Both halves of that decision are settled; this
file is for understanding the structure, not for reopening the question.

## Layout

A sidebar plus a centre panel plus a right panel.

**Sidebar** — repositories, each with its workspaces beneath. A repo shows an icon
probed from the repository itself (17 conventional paths, first match wins:
`public/apple-touch-icon.png`, `favicon.svg`, `app/icon.png`, `src-tauri/icons/icon.png`,
and so on). A workspace is labelled by **its PR title if a PR is open, otherwise its
branch name**; the city name is the secondary identifier. In Cloud organisations the
sidebar also carries `Home`, `Pinned`, `My workspaces`, `Following` and a `Team`
section with presence dots.

octopus diverged here on purpose: one tree holding both projects and workspaces
outgrows the window, so projects moved to a vertical tab strip and the second pane holds
only the active project's workspaces (§10.8).

**Centre** — the agent chat: event stream plus composer. Replaceable by Big Terminal
Mode (`⌘⇧T`, experimental) which puts a full terminal there instead, with sessions that
survive restart and presets that launch an agent CLI directly.

**Right / tabs** — the diff viewer and the Checks tab; terminals open as tabs via `+`
in the workspace tab bar.

**Top bar** — the workspace name (click for details), a link button for `Copy link`,
an eye button for `Follow` (Cloud).

## Chat and composer

- One harness and one model per chat tab; several chats per workspace, sharing the
  branch and files.
- Model picker in the composer. Plan Mode, Fast Mode and reasoning level are session
  controls sitting alongside it.
- `@todos` pulls the todo list into the message.
- `/` opens slash commands, read from `.claude/commands/*.md`.
- MCP status appears in the composer, with a refresh action.
- For Codex, an active goal shows a **goal bar above the composer** carrying the
  objective, its status, its token usage, and pause/resume/edit/clear.
- Inline diff comments become **composer attachments** — the mechanism that turns
  review into the next prompt.
- Checkpoint reversion is a revert icon revealed on hovering your own message.

## Diff viewer

`⌘⇧D`. A file list for navigation, unified or split view, filtering by commit to review
one at a time, inline comments anchored to changed lines, and GitHub review comments
folded into the same surface. Conductor surfaces a **recommended next action** as the
workspace moves toward merge — `Create PR` and onward.

## Checks tab

The pre-merge gathering point: git status, PR metadata, CI and status checks,
deployments, GitHub comments and review threads, todos. Merge actions can be **blocked**
while todos are unchecked or checks are failing.

## Naming and identity

Workspaces are named after cities (295 of them), with `-v2` / `-v3` for repeats. The
city is the directory name — stable so that agents, shells and editors keep resolving
the same path — while the branch or PR title is what the sidebar shows. `⌘K → Passport`
turns the history into a travel log of cities visited.

octopus's `names.ts` does the same job. The reasoning is worth borrowing whole: the
stable, meaningless name is for the _filesystem_, and the meaningful name is the
_branch_, which the agent renames once it knows what the work is.

## Keyboard shortcuts

The docs punt to the in-app dialog (`⌘/`) for the full list. Documented in prose:

| Keys  | Action                                                       |
| ----- | ------------------------------------------------------------ |
| `⌘N`  | New workspace                                                |
| `⌘⇧N` | New workspace from branch / PR / GitHub issue / Linear issue |
| `⌘⇧D` | Diff viewer                                                  |
| `⌘⇧P` | Create pull request                                          |
| `⌘⇧T` | Big Terminal Mode                                            |
| `⌘⇧C` | Copy workspace link (Cloud)                                  |
| `⌘O`  | Open in external editor                                      |
| `⌘K`  | Command palette                                              |
| `⌘/`  | Shortcut list                                                |

octopus's set (§10.8) overlaps on `⌘⇧N`, `⌘⇧D`, `⌘⇧P` and adds `⌘1`–`⌘9` for projects
and `⌃1`–`⌃9` for workspaces — a consequence of the tab strip, which Conductor has no
equivalent of.

## Settings

Organised as `Settings → <section>`: per-repository panes (scripts, files to copy,
preferences, Spotlight, Misc with the root path), plus `Harnesses`, `Environment`,
`Privacy`, `Experimental`, and — for Cloud — `Organization`.

## Platform integration

Mac-only, no Windows or Linux. Registers the `conductor://` URL scheme. Triggers the
ordinary macOS protected-folder prompts (Downloads, Desktop, Reminders) whenever an
agent touches those paths — the prompt names Conductor because Conductor launched the
process, which their FAQ has to explain because it reads alarming.
