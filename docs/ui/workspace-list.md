# The workspace list

**Help sits at the foot of the workspace list**, just above the limits, and only
while a workspace of the project on show is selected — with none chosen, or a
selection left over from another project, it is not there. A
LifeBuoy and the word, as wide as the list so it follows the column as it is
dragged, and gone with the list when it is folded. It wears the composer's
colour ring in rules of its own (`.help-button`) — a faint line and glow at
rest, the line turning and the glow brightening only under the pointer or
keyboard focus, paused rather than reset when they leave, so nothing moves while
nobody is near it. It is a stub for now: pressing it does nothing.

**A branch list that came back full makes the header stop claiming.** The mark
on every workspace row comes from one read of the repository's hundred most
recent requests — one call for the whole project, because a read per row would
be a network call per row on every refresh. A workspace whose request is older
than those hundred is simply not in the answer, and **absent reads exactly like
"has none"**: the header then offered `Create PR` for a branch that already had
one.

So the read says whether it was all of them, and where it was not the header
button is hidden. Leaving it saying `Create PR` would be a wrong sentence said
with confidence, and a second label for the same press — it opens the pull
request tab either way — is a button doing what the tab strip and `⌘⇧P` already
do. The tab asks about _this branch_ rather than reading the capped list, so it
is the one authority on what the branch has. The row's mark stays absent too,
which says nothing rather than something false.

The button also waits for the first answer. Until one lands, "not capped" is
only the starting value, and treating it as an answer showed `Create PR` on a
large repository and then took it away. A refused read counts as an answer: a
repository with no GitHub remote never gives another.

**And a row says when its worktree is standing on some other branch.** `git
checkout` is one command in the workspace terminal, which is a shipped tab, and
after it the name on the row is no longer where work done there will go. The
Changes tab says this at length and _Commit & push_ refuses outright; the list
is the thing always on screen, and it was the one place that said nothing.

A glyph beside the name, in the same shape as the request mark, with the branch
in its tooltip — there is no branch text on the row to hang it on, only the
workspace name. Absent while the worktree is where it should be, which is most
workspaces most of the time: a mark for the ordinary case would put a glyph on
every row and say nothing by being there.

Suppressed for a workspace whose directory is gone, and where git could not be
read at all. The first already says so louder, and two warnings for one fact is
noise rather than emphasis; the second knows nothing about where HEAD is, and
"we cannot say" must not draw a warning on every row.

**The fact costs nothing to learn.** `git worktree list --porcelain` reports the
branch of every worktree and the parser already keeps it, so this is a
comparison in the pass that already decides whether a directory is missing — not
one more `git` per workspace on a row that is re-read after every agent turn.

**The change count follows the work.** It used to be read when the list was —
on create, rename, remove and first load — and never again, so the agent could
rewrite twenty files while the row went on saying what it said an hour ago,
beside a diff pane that re-reads itself on the same event. The list now listens
for the same turn endings and settles for the same 300ms, and re-reads only the
workspace whose turn ended (`workspaces:read`): re-reading its project ran
`git status` and `rev-list` for every sibling after every turn of every agent —
nineteen git processes per turn end with six workspaces, measured. A sibling
catches up on its own turn's end or a full refresh. A turn that ends while the
window is hidden is held and read when the window comes back, and a read that
says what the row already says changes nothing, so the window is not redrawn
for it. That status runs with
`--no-optional-locks`, as the Files tab's does: a plain one holds `index.lock`
for as long as it scans, and a `git add` or `git commit` running in the same
worktree at that moment — another conversation, the terminal, a hook — fails
with "Unable to create index.lock". The Changes pane's diff, read on the same
event, writes nothing either, though not by that flag: `git diff` writes the
index back for a file whose times moved with the flag or without it, so it reads against
a copy of the index instead — and so do that status, the Files tab's and the
pull-request draft's, all through `keptIndexCopies` in `git.ts`. The copy is
kept beside the index and made again only when the index changed. Measured on
a 2,000-file checkout: a turn's end was 18 git processes, 280 ms wall and
826 ms of CPU, because a worktree is checked out in the second its index is
written, so git trusts none of its entries by their times and hashed every
file on every read of a copy it then threw away; kept and written once by git,
the same reads — 19 processes, one more to find the index for the counts —
take 125 ms wall and about 220 ms of CPU, and the `status` that was 80 ms
while it still ran on the index itself is 15.

**A branch says where its pull request stands**, in a glyph beside the workspace
name: green once the checks pass, a spinning green ring while they run, orange
when one has failed, accent while the repository has run nothing, red once it is
merged, faint once it is closed unmerged. Nothing at all where there is no
request, which is most branches most of the time — a mark for that would put an
icon on every row and say nothing by being there. Every state goes out as a word
in the label too.

It costs one `gh` call per project rather than one per workspace, on a minute's
timer while the project is open — and for every other project too while the
status bar shows, on the same clock rather than a second poller of its own.
While a check runs, the open project is read every 15 s instead, so its row
stops spinning when the pull request tab says the checks are done; a watched
project stays on the minute, since nothing of it is on screen but the bar's
count, and a few repositories with long CI runs on the fast clock were a
GraphQL query every 15 s each, all day. A
look that falls due while the window is hidden waits for it, and is taken once
when it is shown. A failure is silent: there is no room on a
row to explain one, the tab says it properly when opened, and a repository with
no GitHub remote is an ordinary thing rather than a fault.

**The workspace list says what each one is doing.** A workspace is a card: an
icon tile, the name, and a line beneath it that says the state in a word. One
mark carries it in the tile — the agent's state takes it while there is something
to report: a turning spinner in the accent while it works, `warning` while it is
stopped on a question, `danger` after a failed turn, `warning` and a pause glyph
where the application's exit cut a turn off, `success` once a session has run and
stopped — and falls back to a code glyph for a workspace nobody has written in.
The word beneath is the same state in the same colour, which is what a reader
who cannot tell the colours apart relies on; `idle` is three words
(_Interrupted_, _Finished_, _Not started_), told apart by whether any
conversation is `interrupted`, then whether any has `started`. Interrupted wins
over finished: one conversation left mid-command is the reason to go back. Two marks side by side would make the list busier than the thing it
describes, and `warning` is the one worth crossing the window for, because that
turn has stopped and is waiting on you. A workspace holding several
conversations draws one dot each inside the tile instead.

**A workspace is added the way a repository is.** The header's "+" is
`AddTile`, the same dashed 40px tile that ends the project strip — an empty
slot, one level down — and turns into a spinner while creation fetches. A
project with no workspaces does not explain where the button is: the first
row's place holds a dashed card of a row's exact size (`.workspace-card`, its
border dashed) that creates the first one and names the branch it will start
from. It is shown while the list is still loading too, as the sentence it
replaced was.
