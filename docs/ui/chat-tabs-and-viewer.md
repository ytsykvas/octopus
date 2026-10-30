# The centre's tabs and the file viewer

**The centre is the agent chat**, scoped to the selected workspace: its worktree
is the agent's working directory and its branch is where the work lands. A
different workspace is a different conversation, not a continuation. Without one
the pane is not the chat at all but an empty state that offers to make one — see
[Empty panes](empty-panes.md).

**Its header is the strip of conversations**, with one button at the right end.
A workspace holds up to three, and they run at once in the one worktree.

The button is the way back to the first message: the log has a way down to the
latest one, and in a long conversation the start was otherwise reachable only by
scrolling. It is a quiet icon button, not the log's floating round one, because
it sits in a header that does not move. The header belongs to `Chat` and the
scroller to each `ChatSession`, so `Chat` keeps an empty slot at the row's end
and the conversation on screen portals its button into it — the scroll and the
pinning stay beside the scroller. It is drawn only while that conversation is in
front and has entries, so a file opened over the chat, or an empty conversation,
leaves no button that scrolls nothing. It is always enabled: a button that
disabled itself at the top would drop the focus a keyboard user had just put on
it.

The branch used to be here, marked with a branch icon, and has moved to the
title bar beside the project's directory: it says where the work lands, which is
a fact about the window rather than about any one conversation, and it was
spending a 36px row on one short string. The centre is the narrowest pane in the
window, so a row is worth having. The strip starts at the pane's left edge
rather than at the 72rem column everything below is capped to: lined up with the
log, it drifted to the middle of a wide window, and tabs are found by where they
start.

The tabs are **underlined rather than boxed**, unlike the right pane's. Those
switch between three different kinds of thing, so each wants an edge of its own;
these are three of one kind, told apart by a name and a dot, and a row of boxes
around "Claude 1" would weigh more than what it labels. The active one is marked
by a 1px rule in the project's colour, and `aria-current` carries that to a
reader — not `role="tab"`, which nothing else in this window uses.

**A conversation is called after the agent that runs it and its place in the
strip** — `Claude 1`, `Claude 2`. A name that needs no inventing, and one that
stops being a guess the moment a second kind of agent exists: it is read from
the chat's `agent`, through `AGENT_NAMES` in core, which is not in the locales
because no language translates "Claude".

It can be given a name of its own — double-click the tab, or take Rename from
its menu, the same gesture that renames a workspace one pane to the left. The
field opens on whatever the tab currently says, so a small correction is a small
edit. **Emptying it gives the automatic name back**, which is a request rather
than the slip it would be on a workspace: a conversation always has a name to
fall back to. Nothing writes the automatic name into the record, so closing the
tab beside a conversation renumbers it instead of leaving it called after a
place it no longer holds. A fork inherits neither the name nor the planning
state of the conversation it continues — two tabs called "auth refactor" is a
strip that cannot be read.

**The dot is the same vocabulary as the workspace list's**, shared from
`agentStatus.ts`: accent and pulsing for working, amber for waiting on an
answer, danger for a turn that failed. Quiet is three states rather than one —
green where a session has run and finished, a hollow dot where nobody has
written yet, and an amber ring where the application quit or restarted in the
middle of a turn. All three are `idle` and the status alone cannot tell them
apart, so `started` and `interrupted` come along beside it: a conversation that
did its work read as untouched, and one cut off mid-command read as finished —
which is how nobody went back to it. The ring rather than amber's solid dot,
because neither the strip nor the multi-conversation tile has an icon to tell it
from a question waiting; the colour is the same because the meaning is — the
work goes nowhere until you act. It lasts until the conversation's status next
moves, which is a message sent to it. The hollow dot is drawn rather than left out, or the strip would shift
sideways the moment an agent started. The colour says nothing aloud at all, so
the whole meaning is in the button's label: "Claude 2: Waiting for your
answer", or the conversation's own name where it has been given one.

A tab's menu — right-click, or the ellipsis that appears on hover — offers to
**rename** it, to **continue the conversation in a new tab**, and to **close**
it. No inline cross: the workspace list settled that question with the menu
alone, and two answers to one question is a disagreement rather than a
convenience. An item that could not work is absent rather than disabled: nothing
to continue before a session has run, and the last conversation cannot be closed
at all — a workspace with none has no way back to one but the first message, and
emptying the only one is `/clear`.

**Closing keeps the conversation, so it does not ask.** It used to delete the
transcript, and a confirmation was the only protection a slip had; now the tab
leaves the strip and the conversation waits in the history, which is the
protection, and a dialog saying "this cannot be brought back" would be untrue.
The clock beside the new-tab button opens that history, newest first, each entry
named by its opening message — the automatic name is a place in a strip it no
longer holds, and "Claude 2" would tell nobody which one it was. Choosing one
reopens it with its history and its session. `⌘⇧T` reopens the one closed last,
the browser's key for the same slip. At the cap the entries cannot be chosen
and say why, rather than failing after the click. The list is read when opened,
not kept live: each entry costs a read of its transcript, so it is read when the
menu is opened and not on every close or reopen, and only as far as the first
message. Twenty are kept per workspace; closing one more discards the oldest.
Sending to a closed conversation is refused, for a window that has not heard it
was closed would otherwise start a session no tab and no status shows.

**Files open beside the conversations**, in the same strip after a 1px rule:
underlined like them, because they are the same kind of thing — what the centre
is showing — with the file's icon where a conversation has its dot. One click in
the tree opens a **loose** tab, set in italics, which the next one-click file
replaces, so browsing a tree does not leave a tab behind per file looked at; a
double-click on the row or on the tab, or Enter in the tree, keeps it. Note that
a double-click **pins** a file tab where it **renames** a conversation — two
kinds of tab, two meanings of the gesture each kind already had in an editor and
here. The strip scrolls sideways once the files outrun the room, and the one in
front is scrolled into view. "Open file" in a file's menu in Changes opens it
here too, kept, rather than in whatever app the system picks: reading a changed
file whole is the common case, a file asked for from a menu is not a glance, and
"Open in editor" in the viewer is still the way out.

A file in front hides every conversation behind it — still mounted, still
streaming — and only the conversation on screen may raise a dialog, so none can
while a file is showing. Every way of asking for a conversation (its tab, `⌘T`,
`⌘⇧T`, `⌥1–3`, a fork, the history) puts the files behind it again, and so does
everything the right pane sends to a composer — a review note from Changes, a
remark or a prepared prompt from the pull request — since a note added behind a
file lands where nobody can see it: wrappers in `App` rather than a call at each
place. `⌘W` closes the file in front and is
left alone otherwise. The files live in memory, per workspace, like which
conversation was in front.

**The viewer is mounted only while its tab is in front**, unlike a conversation:
there is nothing in it to lose by going, and coming forward is exactly when a
file may have changed, so it reads the file again then — and after each turn,
and when the window regains focus. Read-only, highlighted by the diff's own
`highlight()` up to 256 KB, 20 000 lines and lines of 2 000 characters, plain
past that with a line saying why — limits and colouring both in
`useColouredText` (`diff/colouredText.tsx`), which the chat's note cards share.
Two `<pre>`s side by side rather than a row per line: a long file is a handful
of elements, and a selection in the code never picks up the numbers. A deleted
file opens onto what HEAD still holds, under a banner saying so.

**The lines the branch changed are tinted, and the toolbar says how many.** A
file opened from the tree looked the same whatever the agent had done to it, and
what changed is the question a reader opens it with. The marks are measured
against the same merge base as the Changes pane (`lineChanges.ts`), as the
tree's marks are: against `HEAD` a commit would empty the viewer while the pane
still listed the file, and the button below would lead to lines the viewer had
stopped showing. A tint behind the code and the same ranges
in the number column, where a strip says which kind — amber for edited, green for
new — and a red line between two lines marks a deletion, which has no line to
tint. Drawn as one element per range behind the text (`ChangeMarks`), never per
line, and memoised for the reason `ColouredLines` is: the viewer redraws on every
move of a selection.

It costs one `git diff -U0` and one listing for **this path only**, read with the
text and applied in the same step so the marks never land on a file already
drawn. Not asked for anything but text. A read that fails marks nothing and
leaves the file standing, and one that finds what the last found hands the old
object back (`useFileContent`), so a turn that did not touch the file redraws
nothing. A renamed file is marked whole: a diff for one path cannot see the
rename.

**"Show changes" opens the Changes tab on this file.** Offered where the file has
marks, or is deleted — a deleted file has none and is in the pane's list. The
pane is unfolded onto the tab in the write ⌘⇧D makes, the file is opened and a
writers filter that hides it is cleared, and the list is scrolled to it. A request
is one the pane scrolls to once, on the first list that holds the file — the
pane reads as it is shown, so the file the agent just wrote may only be in the
read that follows — and it ends with the pane being put away, or another
workspace, so a later read never moves a reader who has gone elsewhere.

**Code review happens from the viewer.** Selecting lines floats a toolbar over
them: a button per conversation of the workspace — "Add to Claude 2", the one
in front last styled as the primary action — and "Copy path". A conversation's
button opens a small field under the selection; what is written there, or
nothing, goes to that conversation as a note carrying the reference, the whole
lines as they read now, and the remark. **The file stays in front**, so a review
of several files is select, note, next; the conversation's tab counts the notes
waiting in it. Lines are numbered from the text — the newlines between the start
of the code and either end of the selection — which reads the same whether the
`<pre>` holds one text node or a span per token, and a selection that only
reaches the start of a line, as a triple-click does, does not take it. The
toolbar is placed from those numbers and the code's own box — 18px lines
under 12px of padding, told to the `<pre>`s and to `codeSelection` from one
constant — rather than from the range's box, which walks every span the
selection covers: 32ms down a 1 500-line file. The selection is read on every
move of the mouse while one is dragged, and each read used to redraw the whole
file, a span per token, 400ms a move for that file; `ColouredLines` is
memoised on lines and tokens that keep their identity, so a move redraws the
toolbar and nothing else — under a millisecond, measured (2026-10-22). ⌘C in
the code copies the same reference, `src/a.ts:12-18`, rather than the text:
this is a place to point at code from, and "Open in editor" is there for the
text.

These notes are **per conversation** (`useCodeNotes`, keyed by the tab's key),
where the diff's and the review's are per workspace and taken by whichever
composer sends first. They have to be: a note sent to the second conversation
must not leave with the first one's message. Held by tab key like the drafts, so
a conversation closed and reopened from the history finds them where they were
left. The message carries them after the diff's with no heading of their own:
the path, its lines and the quoted code already say what they are.

**Every conversation stays mounted** while its workspace is open, hidden with a
class the way the right pane hides its tabs — one that unmounted would lose its
place in the log and the answer half-streamed into it each time you looked at
another, which with several agents at work is most of the time. Two things
follow from being hidden rather than gone. A `display:none` element measures
zero, so the log's pin-to-bottom is skipped while a tab is away and run again
when it comes back, or a background conversation would scroll itself to the top
on every event. And the plan dialog is drawn **only by the tab showing**: a
modal raised by a conversation nobody is looking at is about work the reader
cannot see and takes the keyboard from work they can. Its tab's dot turns amber
instead, which is how the workspace list already announces a turn waiting where
nobody is looking.
