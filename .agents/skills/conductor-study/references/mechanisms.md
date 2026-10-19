# Conductor: how it actually works

_As of Conductor 0.91.0._

The app itself is compiled, but less opaque than it looks. Three plain-text shell scripts
ship inside the bundle and carry the real implementation of the two most interesting
features, and the runtime that drives them is a JavaScript bundle whose strings read
almost like source (see "The runtime" below). Everything in this file is marked
**observed** (read out of those files), **documented**, or **inferred**.

Described in our own words on purpose — the scripts and the runtime are proprietary and
must not be copied into this repository.

## Checkpoints — **observed**

`Contents/Resources/bin/checkpointer.sh`, 323 lines of bash. Three commands: `save`,
`restore`, `diff`. The design goal is a snapshot that captures everything without
disturbing anything — and, since 0.91.0, a restore that rewrites nothing it does not
have to.

**Saving** never touches HEAD, the index, or a single file on disk. It:

1. Refuses outright if the resolved repo root is not the current directory — the guard
   against a workspace that lost its checkout and would otherwise snapshot or, worse,
   `reset --hard` an ancestor repository (imagine a git-controlled `$HOME`). Physical
   paths are compared so symlinked workspaces still match.
2. Bails out if git is mid-operation, or if the index still holds unresolved conflicts.
3. Records the current HEAD oid, and writes the index to a tree object.
4. Builds a **second, temporary index** — seeded from the index tree so tracked files
   survive even when they match `.gitignore`, then `add -A` over the worktree — and
   writes that to a tree. This is the full working-tree snapshot, untracked files
   included, gitignored ones excluded.

   The scratch directory for it lives **inside the git dir**
   (`<git-dir>/conductor-checkpoint-tmp/`), not in `$TMPDIR`, and each one records the
   pid that owns it. Before creating a new one, anything older than 60 minutes whose
   owning process is gone gets removed. Two lessons worth stealing: keep the scratch
   index on the same filesystem as the object database, and make crash residue
   self-cleaning rather than hoping the OS sweeps it. (Changed in 0.80.0 — 0.79.0 used
   `mktemp -d -t` in the system temp directory.) Since 0.91.0 the script also traps
   `SIGTERM` / `SIGINT` and exits through its cleanup, because the app sends `SIGTERM`
   when a save overruns; only a `SIGKILL` leaves residue for the pruning above.

5. Creates a commit from that tree whose **message carries the metadata**: the checkpoint
   id, the HEAD oid, the index tree, the worktree tree, a UTC timestamp. Author and
   committer are forced to a neutral identity so nothing depends on user git config.
6. Points a private ref at it: `refs/conductor-checkpoints/<id>`.

Because the ref lives outside `refs/heads` and `refs/remotes`, the checkpoint is
invisible to normal git operation and never pushed.

**Restoring** is destructive, but since 0.91.0 it is no longer a `reset --hard`. The
script's own comment gives the reason: Spotlight re-applies the same checkpoint on every
watch event, and rewriting identical files bumps their mtimes and floods the file
watchers of whatever runs in the target. So every step leaves already-matching state
alone:

1. Move HEAD back with a **mixed** reset — and only when HEAD differs, or the index has
   conflicts, or a merge / cherry-pick / revert is in progress. Mixed rather than soft
   because soft refuses mid-merge; mixed rather than hard because it leaves files and
   their mtimes untouched. In the steady state the step is skipped, so a no-op restore
   adds no reflog entry.
2. Re-snapshot the current files into the real index (seeded from HEAD, then `add -A`)
   so its stat information is fresh, then `read-tree --reset -u` to the worktree
   snapshot — which now writes only the files that actually differ — and `clean -fd`
   to drop untracked files the snapshot didn't have (ignored files are kept).
3. `read-tree --reset` the saved index tree to restore staging without touching files,
   then `update-index --refresh` so the next restore or `git status` does not rehash
   everything.

Restoring a checkpoint saved on an unborn HEAD is still unsupported. (0.80.0 did
`reset --hard`, `read-tree --reset -u`, `clean -fd`, `read-tree --reset` — correct, but
it rewrote every file every time.)

**Diffing** takes two checkpoints, or one against `current` — where `current` is built
by the same temp-index trick (seeded from HEAD rather than the index), giving a real
tree object to diff against.

Exit codes are load-bearing rather than decorative: `101` merge/rebase in progress,
`102` unresolved conflicts in the index, `103` refused because the root is an ancestor
of the working directory. Callers distinguish "couldn't, and that's fine" from "broke".

**Documented** on top of this: a checkpoint is captured before each agent turn, so it
spans everything that changed between two user messages. Reverting deletes all messages
from that turn onward _and_ the code changes — the agent ends up with no knowledge of
either. The docs warn against using checkpoints when several chats run in one workspace,
which follows directly: the ref is per-repo state, and two chats interleaving turns
would snapshot each other's work.

**Observed** in the runtime's strings, the caller side:

- Each turn gets **two** checkpoints, at its start and its end, with ids of the form
  `session-<session>-turn-<turn>-<start|end>`, saved with `--force`. When the end one
  lands, the runtime diffs it and emits a "checkpoint created" event carrying that diff
  — which is how the UI can show what the most recent turn changed.
- A save gets **60 seconds**; past that the runtime `SIGTERM`s the process tree and
  `SIGKILL`s it five seconds later. Exit `101` and `102` are logged as skips, not
  failures.
- The chat half is not git at all. The Claude runner passes the Agent SDK's
  `resumeSessionAt` together with `forkSession` on one of its launch paths. **Inferred**:
  that is how a revert drops the later messages — resume the session at the chosen turn
  as a fork — while `checkpointer.sh restore` rolls the files back. The SDK's
  `enableFileCheckpointing` appears in the strings only inside the bundled SDK itself,
  never in a call the runner makes — **observed** as an absence, which a minified
  bundle makes weak. Files go through Conductor's own script either way, and that
  script also has to serve Codex, Cursor, OpenCode and Spotlight.

## Git-busy detection — **observed**

`bin/git-busy-check.sh`, 52 lines, and a small gem. It answers one question — is this
repository in the middle of something that would stop a commit — and returns a single
word: `clean`, or `busy:` plus `rebase`, `merge`, `squash-merge`, `cherry-pick`,
`revert`.

The detection deliberately mirrors git's own `contrib/completion/git-prompt.sh`, and its
comments explain the choices:

- **rebase** is detected by the _directories_ `rebase-merge` / `rebase-apply`, not by
  `REBASE_HEAD` — that ref only exists while the rebase is paused, so it misses the
  general case.
- **merge**, **cherry-pick**, **revert** by the existence of `MERGE_HEAD`,
  `CHERRY_PICK_HEAD`, `REVERT_HEAD`.
- **squash merge** is the awkward one. `git merge --squash` never writes `MERGE_HEAD`.
  A _clean_ squash leaves `SQUASH_MSG` plus staged changes that are perfectly
  committable; a _conflicted_ one leaves `SQUASH_MSG` plus unmerged index entries. So
  it flags busy only when both `SQUASH_MSG` exists and `ls-files -u` is non-empty.

Every path goes through `git rev-parse --git-path`, so it works in a worktree, where
these files do not live where a naive `.git/MERGE_HEAD` would look for them. That detail
is the whole reason the script is correct at all in Conductor's own architecture.

## Spotlight testing — **observed**

`bin/spotlighter.sh`, 111 lines. The feature: keep agents working in isolated
workspaces, but run the actual application once, from the repository root, for projects
that cannot run from a worktree.

The implementation is checkpoints plus a file watcher, and it is very small:

- Run **`watchexec`** (bundled, 7 MB) over the workspace directory, ignoring `*.tmp.*`
  and `.context/**`, with events reported through environment variables.
- On any change: save a checkpoint in the workspace under a fixed id derived from pid
  and epoch seconds, forced to overwrite the previous one.
- Then `cd` to `CONDUCTOR_ROOT_PATH` and **restore that same checkpoint there**.

That is the entire sync. The worktrees share one object database, so a tree written in
the workspace is immediately readable from the root — no copying, no rsync, no diff
application. Restore in the root does the rest.

Consequences that fall out of the design rather than being chosen:

- Sync is **one-way**. Edits made in the root are wiped by the next restore.
- Only git-tracked (and untracked-but-not-ignored) files move; `node_modules` and other
  ignored paths stay put, which is why the root's build caches and running process
  survive and hot-reload instead of restarting.
- If the checkpoint save fails, the sync is skipped with a log line — a distinct one for
  `101` (merge/rebase in progress) — and the watcher stays alive. A failed restore in
  the root only warns.
- Because restore now rewrites only the files that differ (see Checkpoints), the root's
  own watchers see the real changes and nothing else.
- `watchexec` serialises runs, so a burst of writes queues one pending sync rather than
  piling up.
- Everything is logged to `/tmp/conductor-spotlight-$$.log`, including which file
  triggered each sync.

**Documented** but not in the script: turning Spotlight off restores the root's original
state. **Inferred**: the app checkpoints the root before the first sync and restores
that afterwards — the script has no such step, so it must happen in the caller.

## Workspace creation — **documented**

`git worktree`, one branch each, based on the configured base branch, with a `fetch`
from `origin` first so a new workspace starts from the latest remote commit while the
root checkout's branch stays where it was. Nothing exotic; the same thing octopus does.

## Shell environment capture — **documented**

An **interactive login shell** is launched per workspace, from inside the workspace
directory, purely to capture environment variables for later reuse. Directory matters
because tools like `mise` resolve per-directory. There is a **5-second budget**; a slow
or interactive `.zshrc` breaks agent launch outright, which is their most-reported
class of setup bug. Commands then run under `zsh` regardless of `$SHELL`.

## Process lifecycle — **documented**

Stopping a run script: `SIGTERM` to the script's process group, wait five seconds (fixed),
then `SIGKILL` to the group — even when the top-level process has already exited. There
is no walk of the process tree, so what escapes is exactly what left the group: a
daemon, a `setsid`, a tool that starts its own session. That one keeps the port. A
child backgrounded with `&` stays in the group and is cleaned up; the advice is now a
foreground supervisor that handles `SIGTERM` and waits for its children. (0.80.0
documented `SIGHUP`, 200 ms, `SIGKILL`, and warned against `&` without qualification.)

## The runtime — **observed**, with the interpretation inferred

`Contents/MacOS/conductor` (73 MB) is a **Tauri 2** shell — `tauri-2.11.1`, `tao` and a
dozen `tauri-plugin-*` crates in its strings, and it links the system `WebKit`
framework. `Contents/Resources/bin/.internal/` holds `conductor-runtime` (76 MB) plus
four 3-line shims — `sidecar`, `actions`, `logger`, `internal` — each exec'ing
`conductor-runtime <name>`; `bin/conductor` does the same with `cli`. (In 0.80.0 those
helpers were listed here as compiled binaries of their own.)

`conductor-runtime` is a **Bun-compiled** JavaScript bundle (`bun-v1.4.2`, `/$bunfs/`
paths), so `strings -a` returns minified but readable code — including Conductor's own
`package.json`. That manifest is the cheapest way to answer "what is it built with": a
React front end, `xterm` for terminals, `@pierre/diffs` for diffs, `tiptap` for the
composer (probably the "@-mention library" their known-issues page blames for broken
undo — **inferred**), SQLite through `@tauri-apps/plugin-sql`, `@anthropic-ai/claude-agent-sdk`,
`@modelcontextprotocol/sdk`, `posthog-js`. It also pins the agent binaries: Claude
Code, Codex, `gh`, `ripgrep` and `gh-stack`.

What the strings show about the agents:

- Four harness runners behind an `agentType` discriminator (`claude`, `codex`,
  `cursor`, `acp`): `ClaudeAgentRunner`, `CodexAgentRunner`, `CursorAgentRunner`,
  `AcpAgentRunner`. The ACP runner's provider table lists `opencode` — fetched from npm
  at a pinned version, started as `opencode acp` — and a `pi` provider downloaded from a
  Conductor-owned releases repository. Pi is not a documented harness, only a Big
  Terminal preset; treat it as unshipped.
- **The Claude runner is built on the Agent SDK**, not on a hand-driven CLI. It calls
  the SDK's `query()` with `pathToClaudeCodeExecutable` pointed at the bundled binary,
  a `sessionStore`, `resume` / `resumeSessionAt` / `forkSession`, `settingSources`,
  `permissionMode: "bypassPermissions"` on the path seen, the Conductor skill passed in
  `plugins`, and `AskUserQuestion` disallowed and aliased to a Conductor MCP tool
  (`mcp__conductor__AskUserQuestion`). The CLI flags in the strings, such as
  `--include-partial-messages`, are what the bundled SDK passes to `claude` — evidence
  of the SDK, not of a separate integration.
- So the abstraction seam sits at the runner because the four harnesses expose four
  different interfaces (the Agent SDK, Codex, the Cursor API, ACP) — not because there
  is no SDK underneath the Claude one.
- Config keys, matching what the settings schemas already document.

Treat a symbol as evidence of a _name_, not of behaviour. What `AcpAgentRunner` does is
inference; that the string exists in the shipped binary is fact. Dead code, abandoned
experiments and unshipped flags all leave strings behind too.

## Agent session plumbing — **inferred**

There is almost certainly a shared internal notion of "an agent session" — start, send a
message, stream events back, ask permission for a tool — that each runner implements.
The four `*AgentRunner` names make that close to certain. But the shape of that
interface is not observable, so do not describe it as if it were.

Also bundled: `gh` (40 MB, 2.100.0) and `watchexec` (7 MB, 2.3.2) — Conductor ships its
dependencies rather than requiring them on `PATH`, the same reasoning behind bundling
Claude Code and Codex.

## What is NOT knowable

Do not invent answers about any of these:

- How chat transcripts are laid out. **Observed**: `~/Library/Application
Support/com.conductor.app/` holds a SQLite `conductor.db` (hundreds of MB on a used
  machine) and `cache.db`; that transcripts live there is **inferred** — its schema was
  not read, and the user's live database is not the place to go reading it.
- How diffs and the terminal are rendered beyond the library names above — which
  component does what is inference.
- Scheduling, concurrency limits, how sessions are supervised.
- Anything about the Cloud backend beyond "Vercel Sandbox", which is documented.

(The UI framework used to head this list. It is now answered: Tauri around a React app,
see "The runtime".)
