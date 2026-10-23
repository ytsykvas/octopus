# The Scripts tab

**The right pane** holds Changes, Terminal, Scripts and Pull request. The
Scripts tab runs `setup.sh` on its build half and `run.sh` on its server half,
with the workspace's port in `$OCTOPUS_PORT`. Both run on a button: starting a
server because a tab was clicked is a surprise.

**One `Run` sits above both halves**, and is the whole tab in one control: it
builds, and starts the server when the build succeeds. The first thing anybody
does with a new workspace is these two steps in this order, and the second only
makes sense after the first — two buttons made the reader supply the ordering
every time.

**A half says what it is running, and the sequence takes it back.** The sequence
above both halves holds only which step is owed; the halves hold the processes.
A Vite hot update is not a navigation — React Fast Refresh replaces the modules
that changed and leaves the document alone, so nothing in `main` fires and no
terminal is unmounted — but editing a module the sequence is reached through
remakes **its** state while the pty carries on. The tab then offered `Run` over
a server that was already serving, and pressing it started a second one.

So each half announces whether it is running, and the sequence promotes itself
to match. One direction only: a half that is running is a fact, while a half
that is not says nothing about whether the sequence is between steps — the build
reports itself idle exactly when the server is about to take over.

The announcement fires on the **listener** as well as on the half's own state,
which is the whole of how this works. After a hot update `running` never
changed; the only sign that anything forgot is a listener that is not the one
from before. That is why the panel wraps its two in `useCallback` over `adopt`
rather than over the sequence, which is rebuilt every render.

This is a development-only failure — a released build never hot-reloads — but
development is where octopus is written, and it cost most of an evening the
first time.

**The port is settled by `Run`, before the build.** The build half prepares the
workspace too, and `prepare` writes the env block with whatever port the
workspace holds at that moment — so a port settled by the _server_ half
afterwards left the build holding the number it had just moved away from. A
bundler that reads `VITE_*` or `NEXT_PUBLIC_*` at build time bakes that in, and
the pages served on the new port then point at the old one. Narrow, needing the
port to move on the same run as a build, and silent when it happens.

Asking there is safe for the reason the header already gives: `Run` is not
offered while a server is up. So nothing of ours can be listening, and anything
answering on the port belongs to somebody else — the precondition `ports.ts`
states in words, kept by the shape of the header rather than by a flag. The
server half still settles on its way in, which covers a port taken _during_ the
build; that is rarer, and there the choice is a stale bundle or a server that
cannot bind at all.

A failed build stops it there and says so. A server started on top of a broken
build fails in a way that points at the server rather than at the build that
actually broke. A project with no build script skips straight to serving: §4
says no step is mandatory, and waiting on a half that is showing an invitation
to write one would simply hang. With no server script there is nothing to run,
so `Run` is disabled — the server half already carries that invitation.

The sequence is **keyed by workspace**, exactly as the runs are: leaving one
mid-build to look at another must not report the second as building.

**Running is decided on that header — and on the title bar, which mirrors it from the same state — never in the halves.** There were four
controls across the two of them — `Build`/`Rebuild` in one, `Start`/`Restart`/
`Stop` in the other — and beside a `Run` that does both, two of them said the
same word twice. A half's job is to show what is happening; the pressing belongs
where the whole sequence is decided.

One exception, and it is not about running: `Env` sits with the build, because
its variables are what a build reads and the moment you notice one is missing is
the moment the build in front of you did not find it.

One control that is always there, and three that change with the run:

| Showing         | Controls                           |
| --------------- | ---------------------------------- |
| always          | edit the project's scripts         |
| nothing running | `Run`                              |
| building        | `Building…`, disabled, `Stop`      |
| serving         | open in browser, `Restart`, `Stop` |

**The header is two rows.** The sentence saying what Run will do sits above,
with the constant one at its right; the set switch and the controls sit below,
the switch at the left edge. In one row the sentence was the part cut to a
couple of words, and it is the part a reader needs before pressing anything.
The server half's own title row carries its port (`OCTOPUS_PORT=…`, where the
run settled) and `running…` at the right of its name, rather than a row of its
own above the terminal that held one word.

**Every way a half can end reports it, including the one where nothing starts.**
`building` is left only by the sequence hearing that a half is finished, and the
route to that is the session's exit — which a session that never started can
never send. A create that failed used to write its reason onto the terminal's
canvas and stop there, so the workspace reported `Building…` for the rest of the
run with `Run` disabled, no `Stop` drawn, and nothing to press: the exits were
leaving the project or restarting the application. `Terminal` has a third
outcome for it now, distinct from an exit code, because `null` there already
means a signal killed a process that did run. The reason is drawn in the header
as well as on the canvas — the build half is folded on every mount, so the
canvas is the one place a reader is not looking.

**The selected workspace always has a runner**, mounted when it is picked rather
than when the Scripts tab is first shown for it. The title bar starts a run with
the tab out of view, and a token is heard only by a runner that exists: one
mounted on first sight of the tab left a press from the title bar in `Building…`
with nothing to press, for any workspace picked while the pane was folded or
another tab was showing.

**A build can be stopped, and keeps its log.** Its session is ended through the
terminal's own stop token rather than by unmounting it, so the output somebody
stopped it to read stays on screen; a stopped server's terminal closes as
before, because its restart waits on that. The exit a stop causes reports no
outcome — the sequence asked for nothing to be running, not for a failed build —
and a stop pressed before the session exists ends it the moment it arrives.

The constant one is drawn first, ahead of everything that moves. It is the way
to the scripts themselves — see the fold section below for why the header needs
one at all — and a control that lands somewhere else because a server came up is
one people stop aiming at.

The browser control is a **link**, not a button: `setWindowOpenHandler` in
main already hands a `_blank` target to the system browser, so it needs no
channel of its own, and a link is what a reader expects to be able to copy. It
names the port — every workspace serves on one of its own, and which one is the
fact worth carrying.

Never one that cannot mean anything. `Restart` and
`Stop` do not exist before a server is up — the pane would be promising
something it has not got. `Run` goes once one is: what it offers has already
happened, and leaving it there asks the reader to work out how it differs from
the `Restart` beside it.

`Restart` is the common half of a restart: the code changed under a running
server and needs picking up, while the checkout did not. It **waits** — the old
session has to be gone before the new one binds, and `dispose` answers when it
is rather than when it was asked, so the second server no longer fails on a port
the first has not let go of yet.

**The number can change between runs, and nothing announces it.** A port free
when the workspace was made can belong to something else by the time anybody
runs it, so before a server starts — and only while nothing of that workspace is
alive — it is checked, and a taken one moves to a free block. The row already
shows the port and the link already follows it, so a sentence saying it moved
would be telling the reader something two other things on screen already say.

**The port is checked, and only said.** octopus assigns one, hands it over as
`$OCTOPUS_PORT` and links to it, and a script is free to ignore all of that: a
`run.sh` of `rails s` binds 3000 whatever it was told, and the link then opens on
nothing. Five attempts a second apart — long enough that a slow boot is not
called a mistake — and then a line saying nothing is listening there. Nothing is
disabled and the link stays: §4 says the layer is thin, and being wrong about
somebody's script must not block them.

**A run outlives the project being left, and unmounting is the only thing that
ends one.** The pane draws a runner for every workspace it is given, not the
open project's — which it used to, and the effect was that a dev server in one
project died the moment another was opened. The filter had a real reason: two
things reached every runner as the open project's, `$OCTOPUS_ROOT_PATH` and the
env set a workspace falls back to, so a runner left standing would have built
against a checkout that never asked for it. They are answered per workspace now, from its own project's record, and
nothing is shared for the filter to protect.

A workspace whose directory has gone loses all of them, `Run` included.
`WorkspaceScripts` drops a missing workspace, which unmounts its runner and
disposes the session — so the server is already dead while the stage still says
it is serving, and a control left up would point at a refused port.

**`Stop` reaches only what is still going.** Both halves watch one token, since
stopping means stopping this workspace rather than guessing which half is busy —
but a half that has already exited keeps its terminal. The build's log is what a
reader is looking at once the sequence has finished, and `started` exists to
keep output on screen past the process that produced it.

**There is no separate rebuild.** It is `Stop` and then `Run` — two presses, in
the order that frees the port before anything tries to bind it again.

**Every start puts the project's env in place first**, and refuses to run if
that fails. A build or a server missing its env fails further in, complaining
about whatever the missing value fed rather than about the env — and nothing
here makes a build come first, so the server has to do it too. That means both
halves of it: the carried files, which never overwrite, so a file edited inside
the worktree keeps what it has; then the block of typed overrides, appended
below them.

**A file the list named and the worktree has not got is a notice, not a
refusal.** Muted, above the terminal, beside the error bar and deliberately not
in it: an error means the run did not start, and this means it did, one file
short — which plenty of builds survive. What it must not do is stay quiet. A
project re-cloned from GitHub had neither `.env` nor `config/master.key` — both
gitignored, so the clone never carried them — and the first complaint came from
a setup script stopping on a variable nobody had written, which reads as the
script's fault. The line names the files rather than counting them, because the
reader's next move is to open one. A file **already** in the worktree is never
named: that is the ordinary case, and a notice that cried about it would teach
the reader to skip the one that matters.

**The folded build keeps its box.** It is hidden with height zero and
`overflow: hidden` rather than with `display: none`, unlike most tab panes
([right-pane.md](right-pane.md), "Every tab is kept mounted")
— and the difference matters here because this half starts folded on every
mount, so the hidden state is the ordinary one. A display-hidden element
measures zero, and the terminal inside is sized from that measurement before a
line of output is written: either left at xterm's 80×24 default, or floored at
the fit addon's minimum of two columns. Refitting when the pane opens is already
wired and cannot undo it, because the pty was created at that width and the
program running in it has already wrapped its output to match. What is left is
the unreadable fragments somebody opened the pane to read. For the same reason a
box with its width and no height keeps the terminal's rows and takes only its
columns: fitted to one row there, a progress display could not move above it
and every frame would land in the scrollback.

**A build can be stopped while it runs**, beside `Building…` — one that hangs
otherwise left `Run` disabled with nothing to press. It ends through the
terminal's stop token rather than by unmounting it, so the log stays on screen;
see "A build can be stopped, and keeps its log" above.

The fold control on the build's heading is named for what it does rather than
for the word on it: `Build` is also the heading it carries, and two controls
with one name are ambiguous to anything reading the pane aloud.

**An `Env` menu sits on that heading permanently**, not only while the build script
is missing. The moment anyone notices an env is missing is a run that could not
find it, and by then the empty state that might have carried the button is gone.
It is a **sibling** of the fold control rather than a child of it, so reaching
for the env cannot put the build away. It is a menu rather than a button because
the answers are genuinely different in kind: the variables are typed, the files
are copied, showing this workspace's env is not an edit at all, and following
the project's set is a choice rather than an edit. A single button
could only ever reach one of them, and for a project cloned from GitHub that was
reliably the wrong one — nothing gitignored was ever on GitHub to copy.

**Which set it runs with is a switch in the Run row**, one button per set with
the one in force pressed, and nothing at all while a project has fewer than two.
It began inside the `Env` menu and was moved out because it is the question
asked most — one workspace on production data, the next on staging, a build
pulling a different dump for each — and a choice that decides which database
somebody writes to is not one to keep two clicks deep. Every set is drawn
alike: the app cannot know which name means production. The switch is disabled
while a build runs, since the build already has its set in its environment.

Pressing the set already in force does nothing rather than pinning to it, which
would quietly stop the workspace following the project. A press reads the
workspace list again, because that list is what the switch draws from: without
it the switch stayed on the old set while the new one was already stored — and
so did the menu it replaced. `Follow the project`
stays on the `Env` menu as a real entry rather than the absence of a choice, so
a workspace can be put back on the project's set after being pinned.

Moving a workspace while it serves says so, in warning colour, on a strip of
its own under the row — in the row's text it was cut to its first two words,
since the row then holds the switch and four controls. **Two different
sentences**, because a restart starts the server again
without building: where the build ran on the other set, the row says so and
asks for Stop then Run — a restart would pick up the new `.env` and keep a
database restored from the other environment's dump. Only where nothing was
built on the old set does it recommend the restart. Neither is said while
nothing serves, since the next Run builds again anyway.

**None of that could ever appear**, and it is worth recording why rather than
leaving the fix looking cosmetic. A second set could only be made through one
button, and that button asked for the name with `window.prompt` — which Electron
replaces at renderer start-up with a function that throws, in dev and in the
build alike. The throw was the first statement of an async function called as
`void`, so it produced no dialog, no call and no banner: only a console line.
Every project therefore held exactly the one set the migration created, and
`Duplicate`, `Delete` and the choice on this menu were all unreachable. Every test mocked `window.prompt`, and jsdom supplies a
stub that lets a spy install, so the suite was green and fully covered over a
path that cannot run outside jsdom.

**So a name is asked for with a dialog the app draws**, `useAskText` — the
sibling of `useConfirm`, which already states the rule the `prompt` comment was
the one exception to: a native dialog cannot be styled and arrives as a visitor
from another application. It refuses a name as it is typed, using the same rule
core applies at the boundary, so a round trip is not spent on an answer already
known to be wrong. Renaming a set goes through the same dialog — that channel
crossed the whole stack and no component called it.

The third is disabled with no workspace selected. It was not, and the dialog it
asks for is rendered behind a workspace check — so the click was lost and the
flag stayed armed, springing the dialog open by itself on the next workspace
picked. It also closes when the workspace changes: the file belongs to the one it
was opened from.

**That dialog is mounted outside every tab pane**, where the app's other modals
are. Inside one it survived a tab change — a pane is hidden with `display: none`
rather than unmounted, so React never unmounted the `Modal` and never called
`close()`. The dialog stayed open in the top layer, unpainted, and the whole
window went inert.

The third opens the workspace's env file **as it stands on disk**, read-only.
Not a preview assembled from the project's block: what the scripts will read
includes the carried lines, a hand edit made inside the worktree, and the port
as it was actually settled, and a reconstruction would agree with all of that
except reality.

The Env section names the file before the block, because the file is the
question a project answers once and the block is the one it keeps editing.

**The build half folds away; the server half does not.** A build runs once when
a workspace is made and is then read; a server runs for as long as the work
does. Folding the finished one is what gives the one still going the whole pane,
and a control that folded away the thing being watched would be one nobody
asked for.

**And it starts folded, every time.** What a build prints is the same hundred
lines of install and compile on every run, and it is worth reading on exactly
the run that fails — which the header above already says, in a colour, without
the log being open. Unfolded by default it took half the tab from the server
log, which is the half anybody actually watches.

The way to the script editor survives that: a workspace with no scripts is
offered one from **both** halves, and the server half is open. Otherwise a fresh
project would land on a tab that says nothing and leads nowhere.

**And a second way, in the header, that does not come and go.** That offer is an
empty state, so it disappears at the moment the file it offers to write starts
existing — after which a tab whose whole subject is `setup.sh` showed the path to
it, ran it, printed what it said, and led nowhere. The pencil beside the run
controls opens the same Scripts section whatever state the scripts are in.

The two are not duplicates and neither should be folded into the other: one says
**Write** and stands where the missing script would be, in one half; the other
says **Edit** and belongs to the tab. Removing the first puts a fresh project
back in front of a tab that leads nowhere, which is the paragraph above.

The header's is also the only way in before there is a workspace at all: the
halves say so and draw nothing else, while the scripts belong to the project and
are editable regardless. It is disabled only with no project open, where there
is nothing for it to edit — a control that answers a press with silence is worse
than one that says it cannot.

It folds by a class and an `aria-hidden`, never by unmounting — unmounting the
terminal is how Stop ends a run, so a fold that removed it would kill a
`setup.sh` half way through without saying so. Whether it is folded is not
stored, unlike the tab beside it: which tab is showing is a standing preference,
and this is a mood about the run in front of you.

**A run belongs to its workspace**, the way a terminal does, so there is a
runner per workspace and several can serve at once — which is what the unique
port is for. It is the open project's workspaces that get one: the script paths
are that project's, and a runner left standing from another would offer to run
this project's `setup.sh` somewhere that never asked for it. Leaving a project
therefore ends its runs, which is the remaining edge and is written down.
