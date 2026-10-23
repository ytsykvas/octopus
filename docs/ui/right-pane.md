# The right pane

**A terminal not on screen stops being drawn.** Two things make that so.
xterm pauses a terminal its IntersectionObserver says has left the screen, but
in 6.0.0 every line that scrolls asks for the selection to be drawn again, and
the answer redrew every row past the pause — one dev server logging behind
another workspace held a fifth of a core. `components/xtermPause.ts` keeps that
request while paused, for xterm's own resume to draw (xtermjs/xterm.js#6208;
`docs/PROJECT.md` says why xterm is pinned). And the observer has to see the
terminal go at all: `visibility: hidden` does not end an intersection, nor does
a box of no height, so another workspace's terminal or runner, and every runner
of the folded build, carry `.offstage` (`styles.css`) — still laid out, so the
size holds, and moved twice its width out of a box that clips. Measured on a
bare window, one log at 66 lines a second: 25–30% of a core hidden, 4–6% after,
which is xterm parsing the output. A visible terminal costs what it did.

**Two tabs are icons, and they sit at the two ends.** The tab row decides the
pane's narrowest allowed width — the measurement further down is exactly that —
so every **word** in the row raises the floor for everybody for ever. Terminal
and Notes carry an icon each instead, which costs about a third of a word.

Which two is not arbitrary. The ends are the tools somebody reaches for — a
shell on one side, a scratchpad on the other — and the four in the middle are
about the work itself, which is what the words are worth spending the width on.
Files is one of the words, beside the shell: it was an icon first, and a tree
glyph was too easy to miss for the tab most browsing starts in. An icon between
words would read as a mistake; at the ends they read as what they are.

What they may not lose along with the word is their name: the label moves to the
button's `aria-label` and its tooltip rather than disappearing, because a tab a
screen reader announces as nothing would be the real price of the saving.

**The note is the one thing a workspace carries that the agent never reads.**
Everything else in the pane is something the agent acts on or produced; this is
a line the person wrote to themselves about a task that runs for days. Saying so
in the placeholder is part of the feature — a text box in an agent's window is
otherwise assumed to be talking to it.

It **saves itself**: once the typing pauses, and at once on leaving the field. A
note headed "so I do not forget" behind a Save button somebody forgets to press
is a note that was not written. The pause is there because `commit` rewrites
`state.json` whole, so a write per keystroke would rewrite the file per
keystroke — and the pane is remounted per workspace, which is what makes a save
still counting down safe: an editor that loads against one target and saves a
moment later writes the old text into the newly chosen one, the trap the env
editor recorded first.

The ceiling is enforced **in the field**, not only at the bridge. The parse at
the boundary stays — types are gone by then, and a window sending more is what a
boundary is for — but somebody typing must not be allowed to fill a note that
will then be refused. A count appears as the limit comes close and not before.

**The right pane carries six tabs.** Terminal, then Files, Changes, Scripts
and Pull request, then Notes. Build and server were two tabs and are now two halves of one: they
are the same question — what this workspace runs — and splitting it cost a fifth
of a row whose width has to be **measured** because it barely fits. Stacked, a
server can be seen running while a build is read, which two tabs could not show
at once.

Each half is a named region rather than an anonymous box. Both are on screen
together, so "the Run button" is ambiguous to anything reading the pane aloud —
and each half keeps its own `min-h-0`, because a terminal measures itself against
the box it is in and one never told it may be shorter grows instead of scrolling.
So does the terminal's own box inside the runner, and for the same reason with
a twist: the fit reads that box's height, and sized by its content the box was
exactly as tall as xterm's own 24 rows — the fit read them back, never shrank,
and a build run while its half was folded drew over the server half once
unfolded. The runners' box clips as well, so no half can paint outside itself.

**Every tab is kept mounted** behind whichever one is showing, and hidden with a
class — `display: none`, which xterm does see as off screen, so a terminal in a
hidden tab stops being drawn through the pause guard alone. The Scripts tab is
the exception: the title bar starts a build or a server there while another tab
is showing, and a terminal created under `display: none` has no size to fit — it
starts at xterm's 80 columns, and its program lays the log out for them before
anybody looks. So that tab goes `.offstage` instead, laid out at the size it
will have and moved out of the clip that the box around the tabs provides; the
others create nothing while hidden. A terminal unmounted is a process killed — and so is a script, because
ceasing to render its terminal is the entire implementation of its Stop button,
which made leaving the Build or Server tab press Stop without saying so. A diff
unmounted loses which files were collapsed and where the pane was scrolled to,
which a review builds up over several turns. What stops the hidden diff reading
git is a `visible` prop, not being unmounted.

The hidden panes carry `aria-hidden` as well as the class. The class alone says
nothing until the stylesheet has loaded, and four panes speaking at once is what
a screen reader would otherwise hear.

**Which tab is showing is stored**, and `⌘⇧D` opens Changes from anywhere —
unfolding the pane if it was folded, because a shortcut for the changes that
does nothing while the pane is away does nothing where it saves the most. The
value lives in `App` rather than in the pane: the pane is unmounted while
folded, so a tab kept inside it survived neither a fold nor a restart, and the
shortcut has to reach it from outside. Whether the pane is folded is **not**
stored — that is a mood about the current window rather than a preference.

The right pane folds away from **one button in the title bar**, which switches
between collapse and expand in place. The collapse used to sit inside the pane
and the expand in the bar — but a control that folds something away cannot live
inside it, or once folded there is nothing left to click, and the way back has to
be hunted for somewhere else.

Both side panes are resizable and their widths persist. The right pane's floor is
**measured, not chosen**: it is whatever its six tabs need. The four that
carry a label change width with the language — a number picked against English
left the Ukrainian ones overflowing, and since the pane does not shrink,
anything sticking out of it pushed the window wider and put a horizontal
scrollbar under the application. The two that carry an icon do not change at
all, which is the whole reason they carry one.

**The tabs cannot wrap and cannot shrink**, and that is what makes the
measurement mean anything. A button free to squash reports the width it was
squashed to, so the floor came out under what the labels need and the pane
squashed them again — a measurement taken from its own consequence. `Pull
request` is where it showed: the label broke across two lines inside a row 32px
tall. `shrink-0` and `whitespace-nowrap` on each tab are the whole fix.

**The tabs are pinned to the pane's right edge.** The pane is dragged by its
left edge, so widening it only adds empty row on the tabs' left and they stay
where they were. It is `justify-end` on the row, not a spacer or an `ml-auto`
on a tab, because the floor above is measured from the row's children and a
spacer would be counted as one. At the floor the row is exactly as wide as its
content, so nothing there looks different.

The right pane's ceiling
is whatever the window has left after the left column and a usable centre, so it
grows on a large display without a number to maintain. That column is passed
down from `App`: it is the project strip plus a list that is resizable and folds
away, and against the constant it used to be measured by, a list dragged wide
left the centre nothing at all.

**The right pane keeps the width it was dragged to, and the window's edge moves
the centre** — the way a sidebar behaves in most desktop applications. Widen the
window and the pane travels with its right edge at the same width while the
conversation gets the room; narrow it and the centre gives the room back, until
it is down to its own 360 and the pane begins to give way, never below what its
tabs need. The list on the left never yields a pixel.

It was the other way round for a while: the pane absorbed every pixel the window
gained or lost, on the grounds that the conversation stops widening at 72rem and
what the centre took was margin. In use it read as the pane having a mind of its
own — its left edge stayed put while the window was dragged — so it went.

What the window takes is shown, never saved. The config holds the width that was
dragged, and the pane shows as much of it as the window has room for, so the
width comes back by itself once the room does.

**Folding the pane hides it; it never unmounts it.** Its terminals and the
servers running in them belong to their workspaces, and unmounting a terminal is
how one is ended — so the fold used to close every shell and stop every dev
server in the project. It is not hidden with `display: none` either, for the
Scripts tab's reason above: the title bar runs a build with the pane folded,
and a terminal born in a box with no size is born 80 columns wide. Folded, the
pane goes `.offstage` — positioned against the row it sits in, so it keeps its
width and its height, and moved off the window's left edge, where xterm stops
drawing it and nothing can scroll it back into view. Keeping the height too
means a fold resizes no terminal, so a running server is not sent a resize on
every fold and unfold. While folded no tab counts as visible,
so nothing in it reads git, and the tab row is measured again on unfolding.

A change of size that does reach a terminal is gathered for a tenth of a second
before it is fitted (`REFIT_MS` in `Terminal.tsx`): a pane being dragged
changes size on every frame, and every terminal in it — the offstage ones
included, since they keep their layout — fitted itself, reflowed its
scrollback and had its pty signalled sixty times a second each. Gathered, a
drag costs ten fits a second per terminal and ends on the size it ended on, and
a fit that moved nothing — a box that changed by less than a cell — signals
the pty nothing, so whatever runs in it is not made to redraw for nothing.

The fold is kept across launches (`rightPanelOpen`), and every way of unfolding
— the header's button, ⌘⇧D, ⌘⇧E, opening a pull request — writes it, the tab
riding in the same write. Dragging the edge well past the floor folds it too, as
in most editors: past **half** the floor, so a drag that merely overshoots still
stops there, and the same drag coming back brings the pane out again. Released
folded, the width committed is the one the drag began at, so the pane comes back
at the width it had rather than at the floor it was dragged through. The arrow
keys never fold it.
