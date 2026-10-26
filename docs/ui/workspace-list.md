# The workspace list

**Help sits at the foot of the workspace list**, just above the limits, and only
while a workspace of the project on show is selected — with none chosen, or a
selection left over from another project, it is not there. A
LifeBuoy and the word, as wide as the list so it follows the column as it is
dragged, and gone with the list when it is folded. It wears the composer's
colour ring in rules of its own (`.help-button`) — a faint line and glow at
rest, the line turning and the glow brightening only under the pointer or
keyboard focus, paused rather than reset when they leave, so nothing moves while
nobody is near it.

**Pressing it opens a menu of two** (`HelpMenu`, a `DropdownMenu` whose trigger
is the same button, so nothing changes at rest): _Set this project up to run_
and _Why does Run not work?_. Each opens a **new conversation** in the selected
workspace and **sends it a message at once**: the
instruction of that kind (`setupScripts`, `diagnoseRun` — edited in Settings
like the pull request's, and overridden from `.octopus/instructions/`), then a
block of what octopus knows that the agent cannot find for itself —
`workspaces:helpContext`: the checkout, the workspace's name, slug and port and
whether anything answers on that port right now (the probe `workspaces:serving`
asks; the session has the same variables, but as they were when it started,
and these are read now), the env file, the set in effect and its
variables **by name only**, the scripts in effect and where they come from,
whether the repository's still wait for _Allow these_, the carried paths and the
set's problems. _Why does Run not work?_ adds the last build and server from
the same answer, each with how it ended and its last lines — the env set's
values masked out of them, in a fence longer than any backticks they hold, so a
fence of their own cannot end it — or, for a start the Scripts tab refused, the reason
it showed, masked the same way; or it asks for a run where there has been none.
`helpMessage.ts` assembles it; `useHelp` reads all of it before creating
anything, so a failed read opens nothing — a rejected one, from a main that has
gone or lacks the channel, says so too — and a second press while the first is
reading is ignored rather than opening a second conversation.

A new tab, where the pull request pane refuses to start one, because here the
person pressed Help and a conversation is what they asked for, and an ask never
lands in the middle of another task. `useChatTabs.create` takes a `beforeShown`
callback, told the new id once the record exists and before its tab is drawn —
even when the workspace changed meanwhile, since the conversation exists and
takes a place — and waits for it, so the message is on disk when the pane mounts
and reads the history, as a fork carrying out a plan does. Sent rather than put
down: choosing the item is the asking, and the reader still sees every word the
agent got as the first message in the log (§4), editing it in Settings. A send
that fails files the text as that tab's draft instead — a composer reads its
draft once, as it mounts, which is why this happens before the tab is drawn —
and says so (`help.notSent`), so one press of Send retries it. The chat starts in
whatever mode a new conversation starts in. At the cap of three conversations
both items are shown and disabled, saying a tab has to be closed first
(`chat.historyFull`). A script the agent writes appears on the Scripts tab once
its turn ends, and waits for _Allow these_ like any other.

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

**A row says while its pull-request description is being written.** Asking
the agent to describe a change in the PR tab runs on in main after the user
looks at another workspace — that is the point of it — so the row is where they
can still see it going on: a pulsing `Sparkles` beside the request mark, with
the sentence as its label. Only while it is being written. The mark going away
is the sign the text is ready, which needs no "seen" state to keep; a mark for
a written description would stay on until the request was opened.

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

Nothing either on a branch that has **moved past** a request no longer open —
merged or closed, and committed to since. The pull request tab has stopped
calling such a branch merged and offers to open another, and a red mark beside
it said the work was finished when there was new work on it. Only a workspace's
own branch is asked about, one `git` process each: the list holds a hundred
requests, most of them long merged on branches no row draws.

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
