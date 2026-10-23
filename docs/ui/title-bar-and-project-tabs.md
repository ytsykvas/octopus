# The title bar and the project tabs

**One title bar across the window**, not one strip per pane. Each pane used to
draw its own, which pushed the tab strip's fill up behind the traffic lights and
put the project name under them. Its left padding clears the buttons outright,
so nothing depends on how wide the tab strip happens to be.

**Its right end runs the selected workspace's server.** A Play icon, a spinner
while the build goes with a Stop beside it, and then a globe to the server's port beside a Stop — the
same sequence as the Scripts tab's `Run`, read from the same state in `App`, so
a press in either place moves both. Running is the thing done to a workspace
all day, and with the right pane folded the tab that does it is out of reach.
Icons only, with the words as tooltips: the bar is one row for the whole
window. It is absent where the workspace has no server script, disabled while a
repository's scripts wait to be allowed, and marks a failed build with a red
dot — with the pane folded, that is the only place the failure can show.
`Restart` stays on the tab alone.

**Projects are a tab strip**; workspaces are a list of the active one. Putting
both in one tree outgrows the window and makes a click mean two things — select
and fold. Splitting them means neither list grows with the other.

**A project's tile says when its agents need you.** Several agents run at once,
and without this the only way to learn that one had finished or stopped to ask
was to open each workspace. A dot in the tile's corner, in the workspace list's
colours: amber while any of its workspaces waits on an answer — read from the
live status, so it holds until the question is answered — then red for a turn
that failed and green for one that finished. Those two are news only until it
is seen: they are recorded only for a workspace that is not on screen, and
opening the workspace clears them. One notice per conversation, not per
workspace, or a chat that finished would wipe out another still waiting. A
green one is withheld while its conversation is running again (`settle`): a
message left in the agent's queue runs as a turn of its own once the last one
ended — after a Stop, always — and "finished" over a working tab is the one
thing the dot must not say. Withheld rather than dropped: the news reaches the
window before the chat's `idle` does, so an ordinary turn's notice appears a
state write later. The chime has already rung by then; the dot and the toast
wait for the turn that is really last. A red one stays.

**Green is the conversation coming to rest, not a turn ending.** It is read
from `finished`, which the core sends once the conversation has stayed at rest
for a moment — every background agent it sent off ended and its report handed
over — and not from a turn's `result`. The CLI opens a turn of its own to hand
over each finished agent's report, so one piece of work can end in several
results, and a chime for each said "done" over work still going. A failed result
is still news at once.

Kept in the window (`useAttention`, `attention.ts`) rather than in
`state.json`: "seen" is one person looking at one window, and a field under
`StateSchema` is the kind of change that has stopped the application opening
once. A restart forgets the green and red dots, and ends every turn anyway.
No merged-or-not filter is needed, because nothing lights from a state that
merely persists — a long-merged workspace stays dark unless an agent runs in it
again.

The dot sits **inside** the tile's square, not off its corner: the strip
scrolls, and anything past its edge is cut. It is a sibling of the tile's button
with a name of its own, so the tab is still called by its letters. The tiles
grew from 36px to 40px to give it room, and the strip from 56px to 60px with
them.

**The same news is a toast in the bottom-right corner**, up to three, newest
first, each saying what happened — finished, ended with an error, has a
question, a plan to review, or the tool it wants — and where. **Show** opens the
project, the workspace and the very conversation the news is about (`selectIn`),
not whichever tab that workspace last had; × takes the toast down and leaves the
tile's dot until the workspace is opened. No timer removes one: news that
vanishes while somebody is reading something else was never delivered. It is a
`fixed` block drawn into the body, as the menus are, not a `<dialog>` — an open
dialog switches off the window's own keys.

A quiet sound goes with it (`sound.ts`), no more than once in 1.5s, so several
agents finishing together ring once. The default is a chime synthesised with Web
Audio: rising for finished, one note for a wait, falling for an error, at a
twentieth of full volume. The context is suspended once the chime is over and
woken by the next: left running, it kept the audio thread and the device awake
for as long as the window lived, after a sound that lasted half a second. Settings → General can pick one of the files in
`assets/sounds/` instead (`notificationSoundId`); a file sounds the same for
every kind of news. Files work because each is over 4KB: Vite inlines anything
smaller as a `data:` URL, which the window's CSP refuses for media, and serves
the rest from the window's own origin. The list is a `DropdownMenu` whose rows
carry a ▶ (`aside`) that plays the sound without choosing it or closing the
menu, skipping the gap; one audio element plays every file, so a new one cuts
the last off rather than piling up. An id the build no longer ships plays, and
shows as, the chime. The workspace on screen gets no toast and no dot, but it
**does** get the sound while the window is not in front: somebody in another
application is not looking at it either. Settings → General turns the sound off
(`notificationSound`), which also disables the list.
