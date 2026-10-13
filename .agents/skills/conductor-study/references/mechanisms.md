# Conductor: how it actually works

_As of Conductor 0.80.0._

The app itself is a compiled binary, so most of its internals are unknowable. But three
plain-text shell scripts ship inside the bundle, and they carry the real implementation
of the two most interesting features. Everything in this file is marked **observed**
(read out of those files), **documented**, or **inferred**.

Described in our own words on purpose — the scripts are proprietary and must not be
copied into this repository.

## Checkpoints — **observed**

`Contents/Resources/bin/checkpointer.sh`, 273 lines of bash. Three commands: `save`,
`restore`, `diff`. The design goal is a snapshot that captures everything without
disturbing anything.

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
   `mktemp -d -t` in the system temp directory.)

5. Creates a commit from that tree whose **message carries the metadata**: the checkpoint
   id, the HEAD oid, the index tree, the worktree tree, a UTC timestamp. Author and
   committer are forced to a neutral identity so nothing depends on user git config.
6. Points a private ref at it: `refs/conductor-checkpoints/<id>`.

Because the ref lives outside `refs/heads` and `refs/remotes`, the checkpoint is
invisible to normal git operation and never pushed.

**Restoring** is destructive and in three steps: `reset --hard` to the saved HEAD, then
`read-tree --reset -u` the worktree snapshot, then `clean -fd` to drop files the
snapshot didn't have (ignored files are kept), then `read-tree --reset` the index tree
so staging is restored without touching the files again. Restoring a checkpoint saved on
an unborn HEAD is unsupported.

**Diffing** takes two checkpoints, or one against `current` — where `current` is built
by the same temp-index trick, giving a real tree object to diff against.

Exit codes are load-bearing rather than decorative: `101` merge/rebase in progress,
`102` unresolved conflicts in the index, `103` refused because the root is an ancestor
of the working directory. Callers distinguish "couldn't, and that's fine" from "broke".

**Documented** on top of this: a checkpoint is captured before each agent turn, so it
spans everything that changed between two user messages. Reverting deletes all messages
from that turn onward _and_ the code changes — the agent ends up with no knowledge of
either. The docs warn against using checkpoints when several chats run in one workspace,
which follows directly: the ref is per-repo state, and two chats interleaving turns
would snapshot each other's work.

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
- If the checkpoint save returns `101` (merge/rebase in progress), the sync is skipped
  with a log line and the watcher stays alive.
- `watchexec` serialises runs, so a burst of writes queues one pending sync rather than
  piling up.
- Everything is logged to `/tmp/conductor-spotlight-$$.log`, including which file
  triggered each sync.

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

Stopping a run script: `SIGHUP`, wait 200 ms, `SIGKILL`. Hence the documented advice to
keep multi-process run scripts inside one process group (`concurrently`) instead of
backgrounding with `&` — a backgrounded child survives the signal and keeps the port.

## The runtime — **inferred, mostly opaque**

`Contents/Resources/bin/.internal/` holds four compiled helpers: `conductor-runtime`,
`sidecar`, `actions`, `logger`. `bin/conductor` is a three-line shim that execs
`conductor-runtime cli` with the arguments.

Compiled is not the same as opaque. Symbol names survive, and `strings -a` on
`conductor-runtime` yields plenty — **observed**:

- Four harness runners behind an `agentType` discriminator: `ClaudeAgentRunner`,
  `CodexAgentRunner`, `CursorAgentRunner`, `AcpAgentRunner`. So OpenCode is driven
  through the Agent Client Protocol rather than a bespoke integration, and the
  abstraction seam sits at the runner, not at a shared SDK — because there is no shared
  SDK to sit on when three of the four are separate CLIs.
- CLI flags they pass, e.g. `--include-partial-messages` to `claude`.
- Config keys, matching what the settings schemas already document.

Treat a symbol as evidence of a _name_, not of behaviour. What `AcpAgentRunner` does is
inference; that the string exists in the shipped binary is fact. Dead code, abandoned
experiments and unshipped flags all leave strings behind too.

## Agent session plumbing — **inferred**

There is almost certainly a shared internal notion of "an agent session" — start, send a
message, stream events back, ask permission for a tool — that each runner implements.
The four `*AgentRunner` names make that close to certain. But the shape of that
interface is not observable, so do not describe it as if it were.

Also bundled: `gh` (53 MB) and `watchexec` (7 MB) — Conductor ships its dependencies
rather than requiring them on `PATH`, the same reasoning behind bundling Claude Code and
Codex.

## What is NOT knowable

Do not invent answers about any of these:

- How the UI is built (SwiftUI vs AppKit — the binary is Mach-O arm64 and that is all
  we know).
- How chat transcripts are stored on disk beyond "somewhere under
  `~/Library/Application Support/com.conductor.app`".
- Diff rendering, syntax highlighting, the terminal implementation.
- Scheduling, concurrency limits, how sessions are supervised.
- Anything about the Cloud backend beyond "Vercel Sandbox", which is documented.
