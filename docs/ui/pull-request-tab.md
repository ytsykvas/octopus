# The Pull request tab

**The pull request tab is the one place that reaches GitHub for something other
than cloning.** It has one shape from the form to the merge: a header, the
views, and a strip pinned along the bottom holding the next step. The header is
a pill saying where the request stands (_Open_, _Draft_, _Merged_, _Closed_,
_Not opened_; merged and closed in the sidebar mark's colours, so the row and the
pane agree on how one ended — an open request's mark is coloured by its checks,
which the tiles carry here), the number, the time of the last read beside the
control that reads again, a link out, the title as a heading and `branch → base`.
`requestFaces.ts` holds the glyph, word and colour of each state once, for the
pill, the Merge tile and the Merge view's closing card. Under it a request that
exists has three tiles — Checks, Review, Merge — each a value ("1 failed",
"Changes", "Waiting") and the view's name; they are also what picks the view
below them, and the one picked carries a bar in the project's colour.
Buttons with `aria-pressed`, the way `Segmented` draws a choice, rather than a tab
list, which would promise arrow keys and a panel each controls. A branch with no
request has the form instead, or the sentence saying there is nothing to open. Two things
are said **before** the button rather than after it fails: that opening will push
a branch that is not pushed, and that uncommitted work is committed with it. Pushing
touches somebody else's machine, and a button that does that silently is one
people learn to distrust.

The branch is read when the tab is shown and again whenever a turn of one of
the workspace's chats settles, on the same 300ms the Changes pane uses. Read
only on showing, a tab left open through a turn kept saying there was nothing
to open after the agent had committed, until another tab was clicked and this
one clicked back.

**The project's instructions** open where they live, in project settings — one
editor for one file, reached from the place it matters, which is the arrangement
"Write the script" already uses. A second editor here would be a second place
for the two to disagree. The way there is wherever the wording is about to be
used: _Change how it writes them_ under the form's fields, _Instructions for a
new PR_ on a branch with nothing to open, and the last item of the agent's menu
on an open request — kept, alone in the footer, when the request's detail could
not be read, since neither the reviews nor the instructions need it. A merged or
closed one has nothing left to send, and so no menu. It used to be a button at the top of every state,
above a request that had long been opened.

**The form's own draft button is a different thing from the one below**, and the
difference is what makes it fragile. It asks the agent once, with read-only
tools and no session, for nothing but the title, the description and — while
the workspace is dirty — the commit message, each put into its own field to be
read before anything is opened or committed. The message never replaces one
already typed: it used to be held out of sight and committed under on the next
press, which made the one text that stays in the history the one nobody saw.
Meanwhile the instruction it hands over is written for the whole act of opening
a request, and a good one says to run the project's checks first.

So the prompt says what the task is not before handing the instruction over:
nothing is run, committed, pushed or opened, and only what the instruction says
about how the text should read applies. Unframed, an agent read "before opening,
run rspec, rubocop and brakeman", could not — the tools are read-only — and
spent its turn on that, answering with no title in it. The failure looked like
the agent being broken and was the prompt failing to say which job this was.

**Ask the agent to describe it** is that one-shot draft (`draftPullRequest`),
not a message to the workspace's conversation: the instruction — the
repository's, the project's, or the global one in Settings — goes to a query of
its own, and the answer comes back into the form's fields, where it is read,
changed or thrown away before anything is opened. Nothing is added to a
conversation, so none is started for it either.

It asks `gh` nothing while another tab is showing. The diff follows the same
rule, and it matters more here: this leaves the machine, so a hidden tab would be
a network call for every workspace opened. `⌘⇧P` selects it — the shortcut §10.8
had listed since before there was a tab to name — and so does **Create PR** in
the window header, through the same callback, because two copies of "open that
tab" drift the first time one of them is touched.

**The pane is one component per question**, under `components/pr/`, beside the
diff's own folder: the header, the tiles, the checks, the review, the merge
conditions, the footer with its agent menu, and the form for a request that does
not exist yet. What they draw is decided once, in `requestStatus.ts`: one verdict
on the checks (failed, running, passed, skipped, none), one on the merge, the
prompts this moment calls for, the view to open on, and an ordered list of what
wants attention. The tiles read the verdicts and the Merge view and the footer
read the list, because three spellings of "is it ready" are three things that
drift apart — and two had: the tile called a request _Ready_ off the button's
policy while the footer said GitHub would not merge it.

**_Ready_ is GitHub's word, not the app's.** The merge verdict is `ready` only
when GitHub has said the request merges: one it holds back for a required review
or a branch behind its base is `held`, and one it has not worked out yet — the
first read after every push — is `settling`, with its own line saying GitHub is
still checking. Both read _Waiting_ on the tile, and _No conflicts_ waits for
GitHub to say so too. The button still takes a press in both, as before: `gh`
turns one into auto-merge.

**The pane opens on the view that answers the question the request is asking**:
Checks while one is red or running, Review once there is a review or an open
thread, Merge otherwise. That is settled once, on the request's first read, and
then only the reader moves it: a view that followed every read pulled itself out
from under the reader — resolving the last thread jumped from Review to Merge,
and a run starting after a push hid a reply being typed. Settled during render
rather than in an effect, and stored with the workspace and the number, the way
the detail is: numbers are only unique within a repository, so #7 in another
project opens on its own view. The views are hidden rather than unmounted, so a
reply half written under a thread survives a look at the checks.

**The footer holds the next step**: the one line that matters most, the commit
message while there is work to commit, and the buttons — each row wrapping
rather than squeezing, so at the pane's narrowest, or in a language with longer
words, a press drops a line instead of running off the edge. The line is the
first thing wanting attention, or _Ready to merge into main_, and it is a polite
live region, so a press that changes it is read out. Three warnings about the
press below take the line rather than adding a block: the env file git does not
ignore, while there is work to commit; that the branch has no commit of its own
to amend, which a disabled button's tooltip could never say; and that an empty
field would replace a commit already on GitHub. The commit field has no hint
under it: its placeholder says an empty one amends, and the button beside it
says _Commit & push_ or _Amend commit & push_. The field sits by its button
because an empty one amends, and a field kept in another view would amend
unseen. **The green button is the next step**: committing while there is work to
commit, else sending the commits that are waiting, else merging. Push and Merge
stay beside it, quiet, Merge with every reason it has for refusing. Merged, the
one press left is the red removal; closed, there is no footer at all. A press
that removes its own button — Push once nothing is left, Merge once merged —
leaves keyboard focus on the pane rather than at the top of the window
(`useFocusKeeper`).

Two reads feed it, and they are apart on purpose. `workspaces:pullRequest` says
whether the branch has one; `workspaces:pullRequestDetail` says what has become
of it. When the first fails the pane blanks, because nothing on it is true any
more; when the second fails the number, the title and the link stay and the
error sits under them. One `Result` could not say both.

**The detail re-reads itself every 15 s** while a check is running _or_ while
GitHub has not decided whether the branch is mergeable — a self-rescheduling
`setTimeout` rather than an interval, so a slow reply never has a second read
stacked on it — and held while the window is hidden, so a check finishing
behind it is read once, when the window is shown. The second half of that condition is load-bearing: mergeability
is computed asynchronously, so the first read after every push says it is
unknown, and a request whose repository runs no CI has no pending check to wait
on at all.

**And it reads again when a turn ends in the workspace.** A check that has
_failed_ is not pending, so the poll above stops at exactly the moment a fix is
on its way — and an agent pushing that fix in its own worktree raised nothing
the pane listened to. It subscribes the way the diff pane does: filtered on the
workspace rather than the chat, on `error` as well as `result`, skipped while
the tab is hidden and held while the window is, settled for the same 300 ms. Not a slow poll while a check is failed,
which would ask GitHub about an abandoned request for ever. The time of the last
read sits beside the refresh control, because a push from the built-in terminal
raises no event either, and a pane that says nothing about when it looked reads
as current however old it is.

**A check's state is a word as well as a mark**, and so is the review's verdict.
A colour reaches nobody using a screen reader, and it is also the only handle a
test has on which state a row is in — the lesson the tab row already
carries ([right-pane.md](right-pane.md)).

The word and the duration are **two spans**, and sharing one is how the promise
above went unkept for every finished GitHub Actions check: `took ?? word` looks
like a fallback and is not, because a `CheckRun` reaches a finished state only
through `COMPLETED`, which carries both stamps. The duration therefore always
won, and a failure read as a red cross and `1m4s`. The duration is drawn first
so the words line up in a column against the link rather than each starting
wherever the number happened to end.

**Add to chat** puts a remark from the review into the composer rather than
sending it. The reader has a question about it, and the question is the point.
It rides the same strip as a note written on the diff, though the two are
separate stores: the diff pane narrows a `DiffComment` on every row it draws,
and a union with a member it can never hold would put an unreachable guard in
each of those places. `attachments.ts` is where they become one list, in
`ChatSession`, which is already the layer that turns a controller into a prop.

**A review thread is answered here**, on the last note of the thread. Half of
answering a review is saying why something was left as it is, and that sentence
fits in a reply and nowhere in a commit — before this the reader read the thread
in octopus and opened a browser to write one line.

On the **last** note and not on each, because the three kinds of comment are one
list in time order and a thread's notes are scattered through it: `Resolve`
repeated down a thread reads as three separate things to settle, and a reply box
in the middle of one reads as though it would land there.

The reply is sent and then the request is **read again** rather than added to
what is on screen: GitHub decides what a comment ends up looking like, and a
pane drawing its own guess is a pane that can disagree with the request it is
showing. A refused reply leaves what was typed where it is — the sentence took
thought, and clearing it makes the reader write it twice to find out the second
attempt fails too.

**A red check disables Merge, and says how many failed.** The other three
conditions on that button — a conflict, a draft, a merge already in flight — are
refusals GitHub would make anyway, and saying so here only saves a round trip
that ends in an error the pane would have to explain. This one is not: GitHub
merges over a check nobody marked required. It is a policy the app keeps, it is
hard, and the way past it is to fix the check or to merge in the browser, where
nobody does it by reflex. The window header's own merge button has always
refused on this, and until now the two disagreed about the same request.

**A check still running holds it too.** `gh` would take the press and turn it
into auto-merge, which is a fair thing for `gh` to do and the wrong thing to
offer beside a list that says "running" — the reader is looking at work in
progress and a button that would merge past it.

Counted from the list rather than from `mergeStateStatus`, which is GitHub's
summary of whether _required_ checks are settled: a repository that marks none
required reports itself perfectly mergeable while its whole suite is still
going. What the reader can see is what holds the button.

Only what is reported holds it. A repository that runs nothing has no checks at
all, and waiting for checks that will never arrive would leave it unmergeable
from here for ever.

And while this pane is giving its own reason, GitHub's `unstable` note is
dropped. That note says merging is allowed anyway, which stopped being true the
moment a check of ours took the button — two sentences contradicting each other
under one button is worse than the quieter one going.

**The commit message is typed, and an empty one amends.** The field is the
same one the create form carries — one component, because two fields for one idea
drift, and this app has already spent a commit deleting a second copy of a
function for that reason. What differs is the fallback, and so what is said
about it: the form carries a sentence under the field because it commits under
the title when the field is empty, and the agent's draft fills that field rather
than standing behind it. Here there is neither, so the field's placeholder and
its button say what empty does instead, and an
empty field does not commit under a sentence nobody chose — the button reads
_Amend commit & push_ and folds the work into the branch's last commit, which
keeps the description that commit already has; with text in the field it reads
_Commit & push_. The message was fixed at "Answer the review" until the field
existed, on every press, whether or not anybody had reviewed anything.

Amending is refused where it would rewrite what is not the branch's: on a branch
with no commit of its own the button is disabled and the footer's line says why,
since HEAD is then the base's commit. A last commit already on GitHub is replaced there with a
forced push, but only over a remote tip this checkout already holds — a commit
pushed from somewhere else would be thrown away, so that case is refused with a
sentence instead — and with the lease pinned to that tip rather than left bare,
which a background fetch would otherwise make protect nothing.

**What is left to push is counted from the commit the remote just named.**
`ls-remote` prints `<sha>\t<ref>`, and the sha was being thrown away — so the
count came from this clone's cached refs, which go stale exactly when the live
read would have been right. A branch pushed from a second checkout has no
tracking ref here, and the pane said a commit was waiting for a branch that was
fully pushed, with Push reporting "Everything up-to-date" for ever.

There is a third answer, and it is drawn rather than rounded to zero: the
commit the count starts from is on the remote and may not be in this checkout,
and HEAD may be standing on another branch. Neither can be counted here and
neither can be pushed past, so the button goes with the number and a sentence
takes their place.

The ref is asked for in full, because the pattern matches the **tail** of a ref
path: `--heads origin anna` also finds `refs/heads/octopus/anna`. Every
workspace branch is `<prefix>/<name>`, so a branch the remote does not have read
as pushed whenever another prefix ended in the same segment.

**Push sends what is already committed.** _Commit & push_ appears only while
the worktree is dirty, so work the agent committed — or the reader committed in
the workspace's terminal — had no way onto the request except the terminal. A
branch can be in both states at once, something committed and not sent and
something else not committed at all, so Push stays beside _Commit & push_, quiet
while committing is the green press. Pushing alone is how the agent's commits go
out without what else is lying in the worktree — an env file git does not
ignore among it, which committing would stage; the redesign that briefly hid
Push while there was work to commit left committing as the only way to send
them. The count of waiting commits is read against the branch's own
copy on the remote, which is a different question from the `ahead` the form uses:
a branch fully pushed is still ahead of `main`.

**A merged request offers to remove its workspace.** §3 draws the lifecycle as
ending in an archive, and that was the arrow the app did not draw: a merged
workspace looked exactly like a working one in the list, so the list filled with
finished work and the reader had to remember which of eight branches was done.

Offered off the request's **state** rather than off the press that merged it,
which is what makes it appear for a merge done from the header or in a browser
too. And it offers rather than acts: a merge is somebody else's repository
changing, removing a directory is this machine's work disappearing, and the two
should not ride on one press. The flow behind the button is the sidebar's own,
so it asks about uncommitted work and about the branch exactly as the list does.

A **closed** request is not a finished one — it is reopened, or the branch is
reworked and opened again — so only a merge draws this.

**A request that is no longer open is current only until the branch moves past
it.** GitHub keeps a branch's newest request as its newest until another is
opened, so a branch merged and then committed to went on reading as merged: the
one press left was removing the workspace, and the work after the merge had no
way onto a request. Once the branch has commits after the request's last one
(`headRefOid`), the branch reads as having no request, and the pane offers the
form again. A last commit this clone does not have cannot show that, so the
request stays — the same "cannot say" that keeps the push count from rounding to
zero.

**The request moved past is named above the form** (`PreviousRequestNote`),
with a link to it: without a word about it, a branch that had a request read as
one that never did, and the merge looked forgotten. **Where the base has to come
in first, it offers _Update from main_.** A squash or rebase lands the content
and not the commits, so the branch still carries every commit the base took in
another form, and a second request's diff would show those changes again beside
the new work. The button fetches the base and merges it in — a merge rather than
a rebase, because the branch is already on GitHub and a rebase would have to
force over it. Afterwards the diff holds only the new work; the old commits
stay in the request's list, since they are still not the base's.

The offer is `needsBase`: the request's commits are not on the base **and** the
base is not in the branch. The first half alone never changes after a squash,
so the warning and its button outlived the update that answered them; and the
base the pane reads is a tracking ref nothing fetches after a merge on GitHub,
so an ordinary merge read as a squash. A base the branch already holds, however
stale, needs nothing. It is a merged request's question only — none of a closed
one's commits reached the base to come back — and the button waits for a clean
worktree, saying so, because git refuses to merge into a dirty one.

A merge that fails is aborted rather than left in the worktree, where it would
be a half-finished merge in a directory an agent is about to work in with
nothing in the pane saying so: the reader is told git's reason, under
`updateFailed` rather than a word for a conflict, since an unknown committer or
a refusing hook fails it too. Where the abort itself fails, `MERGE_HEAD` says
so, and `updateLeftMerging` tells the reader the workspace is mid-merge instead
of claiming the branch is as it was.

**Resolve goes both ways.** Undoing one is a single click on GitHub, and a pane
that can do a thing but not undo it sends the reader to the browser for the half
it kept, which is the failure the whole tab exists to avoid.

**The prepared messages** — fix the checks, answer the review, review it, review
it with several subagents, resolve the conflicts — each send the project's
instruction plus a line naming the request. They live in one menu at the foot of
the pane, _Ask the agent_, wearing the composer's ring (`Button`'s `agent`
variant): the row of buttons they were had grown to six and wrapped, and the ones
that answered the moment looked like the ones that are always there. The ones
that apply now come first, the two that always do sit under a line, and the
instructions close it. Without a conversation every prompt is there and
disabled, with the reason above the first.

**Three of them end in a push the app makes.** The agent may not push (§12.3 of
`PROJECT.md`), so fixing the checks, answering the review and resolving the
conflicts name themselves when sent, and the branch goes up once that turn has
ended well. Pressed while the agent is still working, they are refused with a
message saying to wait. A push that fails, or one refused because `origin` was
pointed elsewhere during the turn, says so in the conversation. A project's own
copy of one of these instructions that still says "push" is met by the refusal
and the agent stops; the shipped wording says to commit and stop.

Three of the five appear only when they would mean something: answering a review
once somebody has left one, resolving a conflict against one, fixing the checks
while one of them is red. Which condition a prompt waits on is a word on its row
rather than a flag per condition — two booleans would allow a row that is both,
which is a state nothing means.

**Fixing the checks names them.** The message carries the red checks and their
job links under the instruction, because the id at the end of such a link is what
`gh run view --job <id> --log-failed` takes, and without it the agent is guessing
which run went red. The log itself is not pasted in: a message is capped at
100 000 characters and a CI log routinely runs past that, so octopus would have
to truncate it — possibly past the error. The agent reads it where it lives, and
can read it again after it pushes.

**Re-running the checks is two buttons**, under the list in the Checks view and
only while one is red: _Failed_ restarts the failed jobs of each run that has
one (`gh run rerun --failed`), _All_ restarts every run whole. The run id comes
from the job's link, the only place the rollup carries it, so a status from
outside Actions has none and is left alone. `all` skips a run still in progress,
because GitHub refuses to restart one and that refusal would stop the rest.
The rollup is read again in core rather than taken from the pane, in the same
call that checks the number is this branch's request.
