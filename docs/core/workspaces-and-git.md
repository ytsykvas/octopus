# Workspaces and git

## Uniqueness has a scope

Before rejecting a duplicate, ask what it is unique **within**. A workspace name
and its branch are unique per project; the id is unique across the app. See the
table in [data/state.md](../data/state.md).

## git is asked about git

A branch outlives the worktree it was made for — removal keeps it unless asked
otherwise. So a name free in `state.json` may still be taken in the repository,
and `worktree add` will refuse. `takenByBranches` in `workspaces.ts` exists for
exactly this, and reads the remote-tracking branches as well as the local ones:
the copy on `origin` outlives even a deleted local branch. A rename is refused
onto either, unless the copy on `origin` is the workspace's own upstream.

GitHub remembers a request after its branch is gone, so no choice of name can
settle that alone. A request opened before the workspace came onto its branch —
created, or renamed onto it (`branchSince`) — is never its own (`openedFor` in
`pullRequestShapes.ts`), and the pane, the list beside it and the removal
check all ask with the workspace rather than its branch name.

## A workspace branches from a base that was just fetched

`git worktree add` was given the project's base branch, which meant this
checkout's _copy_ of it — as of whenever somebody last fetched by hand. On a
real project that was a fortnight; the workspace started a fortnight behind and
nothing said so, so the cost arrived at review.

`resolveBase` in `remotes.ts` answers where a base's state actually comes from,
in four steps: a base that is already remote-tracking is taken as it stands; a
local branch follows what git would pull into it, which may be named
differently; failing that, a remote carrying the same name; failing that,
nothing. The remote comes from `git remote` rather than from assuming `origin`,
which is what makes a differently-named remote work and stops a branch called
`feature/x` being read as a remote called `feature`.

**A repository with no remote is not a failure.** There is nothing to fetch and
nothing that could be stale, so creation proceeds as it always did — that is the
project added from a local folder, and it is answered by the first command.

**A remote that refuses stops the creation**, before anything exists to roll
back. A stale base is the whole failure being prevented, so producing the
workspace anyway would defeat the point.

**The branch that results tracks nothing, and `--no-track` is what makes sure
of it.** Starting a branch from a remote-tracking ref is exactly the case git's
default `branch.autoSetupMerge` sets an upstream for, so once every base
resolved to `origin/…` every workspace branch was born tracking the project's
base. Nothing reads that upstream — the pull-request path pushes with
`-u origin <branch>` itself — but under stock `push.default=simple` a bare
`git push` in the worktree is refused, and the first thing git suggests is
`git push origin HEAD:main`. A hurried reader following the suggestion puts the
workspace's work onto the base branch, which is what a worktree per task exists
to prevent. It is invisible with `push.default=current`, so looking for it on
the wrong machine finds nothing.

The fetch is the only command in `src/core` that leaves the machine on purpose,
and the only one given a deadline and an environment. `GIT_TERMINAL_PROMPT=0` is
the load-bearing half: git spawned from Electron has no controlling terminal, so
a fetch that decides to ask for a password writes the prompt nowhere and waits
for ever, behind a button with no way to cancel.

The same resolution has to serve the reads. `baseRefOf` in `service.ts` applies
it to the diff, the count of commits ahead and the merged check — a workspace
cut from `origin/main` and measured against local `main` reports a fortnight of
other people's commits as its own. It falls back to the stored name when git
says nothing, because a repository that was moved answers no question at all and
those reads must still report the workspace as missing rather than throw.
A resolution still running is shared with whoever asks for the same project
meanwhile, and dropped as it settles: a turn ending fires the row, the diff and
the file sides at once, and each resolved the base on its own. Nothing is ever
answered from an older resolution, so the callers that act on the answer use it
too.

## An operation that fails cleans up after itself

Creating a workspace makes a directory, a branch and a record. If the record
cannot be written, `rollbackWorkspace` undoes the first two. Debris left in git
is invisible to the app but still holds its name, so one failure would otherwise
become permanent.

Rollback is best-effort and never throws: it runs while another failure is being
handled, and a second must not replace the first.

Removal is the same rule read backwards. `removeWorkspaceById` asks
`ensureRemovable` before it closes a single session, because everything after
that line destroys something a refusal cannot give back — and the refusal is
the ordinary path, not a rare one: the pane pre-ticks the delete-branch box, so
a clean workspace whose commits are not merged refuses every time. The split
between `ensureRemovable` and `discardWorkspace` exists so that a caller with
work of its own to do in between cannot accidentally ask twice; asking twice is
worse than it sounds, because the cleanup script runs in the worktree and a
script that writes there would make the second answer differ from the first.

## An update applies every field it carries

`updateProject` lists fields explicitly, which protects against writing back a
stale value — and silently drops any field added to the type but not to the
update. That is why the colour picker did nothing for a while. A test per field
is the only thing that catches it.
