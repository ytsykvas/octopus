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
onto either. The copy can never be the workspace's own: a workspace whose
branch has been pushed is not renamed at all (below).

That copy outlived the branch itself, too: GitHub deletes a merged branch, the
fetch keeps the copy, and the name stayed taken for good — one checkout had
lost 25 names to branches that existed nowhere. So a creation, once its fetch
has answered, drops the copies under the project's prefix that `origin` no
longer has (`pruneGoneBranches` in `remotes.ts`), for the next creation to
draw from. Never one whose branch still exists here: that is a live workspace
whose request was merged, and its copy is what tells the pull request pane the
work went out. A failure there costs a name, never the workspace.

**Removal never deletes the branch on `origin`, and must not.** That would be a
push the user did not make, to a repository other people share: it closes an
open request, takes a branch somebody else may be on, and cannot be taken back
from here. Whether a merged branch goes is GitHub's own setting, _Automatically
delete head branches_; an unmerged one stays until a person deletes it.

GitHub remembers a request after its branch is gone, so no choice of name can
settle that alone. A request opened before the workspace came onto its branch —
created, or moved onto it by a rename or a new kind (`branchSince`) — is never its own (`openedFor` in
`pullRequestShapes.ts`), and the pane, the list beside it and the removal
check all ask with the workspace rather than its branch name.

## The branch carries the workspace's kind

A workspace branch is `<prefix>/<kind>/<name>` — `octopus/fix/anna` — where the
kind is the strip on its card (`workspaceKinds.ts`), `feature` until somebody
picks another. Branches made before kinds are `<prefix>/<name>` and are left
there: a branch moves only when a rename or a new kind moves it anyway. A
rename that leaves the slug as it was — the same name in other letters — moves
nothing, so it never brings such a branch onto the new shape, nor carries a
pushed one onto a kind it was deliberately kept off.

`takenByBranches` reads both shapes, and takes the segment after the prefix as
a kind only when it is one, because a name may hold a slash of its own. That is
approximate in one direction: a workspace from before kinds named `fix/login`
reads as holding `login`. One name too many is held, never one too few, and the
two shapes cannot collide in git.

**A branch named after a kind leaves that kind no folder, and the branch goes
round it** (`KindDetour`, `routeBranch` in `workspaces.ts`). A workspace from
before kinds once renamed `feature` sits on `octopus/feature`, and git cannot
keep `octopus/feature/anna` beside it — here or, through the push, on
`origin`, whose copy removal never deletes. Refusing made every creation in
such a project fail, and the kind unusable across it. So a creation or a rename
takes the shape from before kinds, `<prefix>/<name>`, and a new kind changes
only the label, as it does for a pushed branch. Nothing records the detour: the
window is told once (`workspaces.kindDetour`), and the record holds the branch
as it is. Only the kind's own folder has a way round — anything else in the way
is refused as below.

**A new kind moves the branch only while it has never left this machine**
(`hasLeftMachine` in `git.ts`: an upstream of its own name in the config, or a
copy on `origin`). GitHub keeps a pull request on the branch it was opened from,
so a workspace that moved off a pushed branch would lose its own request; past
the push the kind is the card's label and nothing more. The config is asked
rather than `@{upstream}`, which stops resolving once GitHub has deleted a
merged branch and the copy here is pruned — and the request is still there.
Only an upstream of the branch's own name counts, which is what `push -u`
writes: until `--no-track` every workspace branch was born tracking the base,
the config still says so, and read as "pushed" it froze the name of every
workspace made before then.

**A rename asks the same, and refuses** (`branchPublished`): a new name is a new
branch, and a workspace moved off a pushed one loses its request just the same.
Refused and said, rather than done halfway — the label alone changing while the
branch stays would leave a name the branch no longer matches. A rename that
keeps the slug, the same name in other letters, moves nothing and goes ahead.

**What moves a branch and what pushes it wait on each other**, one workspace at
a time (`oneAtATimeEach` in `parallel.ts`): a rename, a new kind, Commit & push,
Amend & push, Push, Create PR, the push after a turn, and removal — which reads
the branch it deletes. A new kind asked while the first push
was still on its way found no upstream yet and moved the branch out from under
the request about to be opened from it — or the push, holding the old name,
found nothing to send. Each reads the workspace once its turn comes. And git
moves the branch before the record is written, so a write that fails puts the
branch back (`restoreBranch`) rather than leave the two naming different
branches.

**Refs are files**, so `octopus/feature` and `octopus/feature/anna` cannot both
exist. git says so only as "cannot lock ref", halfway through. `branchBlocker`
asks first — for a branch above or below the name, here or on `origin`. One
named after the kind is gone round (above); for anything else a creation, a
rename and a new kind each refuse with `branchBlocked`, naming the branch in the
way — or with `branchBlockedRemote` when what is in the way is a copy on
`origin`: nothing local stops the branch then, only its push would fail, and the
copy is deleted on `origin` rather than renamed from here. The workspace's own
local branch is never in its own way:
`git branch -m` lets go of the old ref before taking the new one. Its copy on
`origin` stays, and still counts.

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
The agent CLI's own sessions follow the same order: listed while the worktree
still exists, deleted only once its record has gone, so a removal that fails
keeps its history ([transcripts-and-ports.md](../data/transcripts-and-ports.md)).

A removal can also stop partway. When a dev server or a test run keeps writing
into the tree, `git worktree remove` has already dropped its own part — the
`.git` file and the entry in the repository — and then fails on the files, and
every retry fails on "is not a working tree". The folder is on disk and git does
not list it (`isOrphaned`). Nothing in it is under git's care, so `git status`
there cannot say what is at stake: it answers for whatever repository lies above
the folder, or fails and reads as clean. Any file in it counts as work that
would be lost (`holdsLeftovers`), the same refusal and the same forced
confirmation a dirty tree gets, and once the user has agreed — or the folder is
empty — it is deleted by hand and the entry pruned. A repository git cannot be
asked about never counts as an orphan, so silence is not what deletes a folder.

A squash or rebase merge rewrites the commits, so git alone calls such a branch
unmerged; the last thing asked is whether GitHub merged the branch's request.
**That word covers the commits the request carried and nothing after them.** A
request the branch has moved past (`movedPast` in `pullRequests.ts`) is no
longer the branch's request at all, so a branch committed to after its merge is
refused like any other — it used to be deleted on GitHub's word, and the work
after the merge with it.

## An update applies every field it carries

`updateProject` lists fields explicitly, which protects against writing back a
stale value — and silently drops any field added to the type but not to the
update. That is why the colour picker did nothing for a while. A test per field
is the only thing that catches it.
