# The diff

One scrolling column, not a list beside a viewer. The pane is 360px by default,
and a second column inside it leaves neither half readable — so the file headers
are **sticky** and the column doubles as the list, which is what the navigation
was for. Sticky needs the scroller to be the only thing hiding its overflow
between it and the header; an intermediate `overflow` anywhere in between and
the headers stop sticking with nothing to say they have.

**A file with no lines still says what happened to it.** A rename has none by
construction and carries "moved from" above the body; a permission change has
none either, and used to draw a chevron, an `M`, a path and a revert control —
a live, revertable file that changed nothing, which reads worse than an empty
row. It now says "made executable", or spells the two octal modes for anything
rarer, which is also what stops a type change being reported as a bare `T`.
Drawn for a file with hunks too: a mode change beside content changes was the
quieter half, since the counts and the body made that row look completely
explained.

That bit is load-bearing here rather than a curiosity. octopus chmods the
scripts it runs to 0755 and one without it fails outright, so `.octopus/`
scripts and `.claude/hooks/` are exactly the files an agent makes executable in
this app — and the pane was blind to a class of change the app then acts on.

**Who wrote a file, once more than one conversation could have.** Three
conversations share one worktree and this pane shows their work merged into a
single diff, so a file header carries the names of the conversations recorded as
having written it — named exactly as the tab strip names them, so a mark here
and a tab there are recognisably the same one. A strip of chips above the list
narrows it to one of them, and pressing the chosen chip again clears it.

Both are drawn only where they answer something: nothing at all for a workspace
holding one conversation, where every mark would say the same name, and no strip
where none of the files on screen has a writer, where every chip would empty the
pane. A file nobody here is recorded as having written — edited by hand, or
written before any of this was recorded — carries no mark and is never hidden by
the filter. The record itself is `writers` on the workspace, described in
[data/state.md](../data/state.md): by file rather than by line, because a line number recorded
now points somewhere else by the time the pane draws it.

**What is measured against what.** The left-hand side is the merge base of the
project's base branch and the workspace's HEAD, and the right-hand side is the
working tree — so committed, staged and unstaged work all show, while whatever
landed on the base branch after the fork does not. A change staged and then
reverted in the working tree is invisible, which is the right answer for a pane
that reports what the workspace now holds.

**A repository nested in the worktree is one row that says so.** Cloned or
initialised inside it rather than added as a submodule, git lists it as
`nested/` and never looks inside. The row has nothing to read: git records such
a folder as a link rather than its files, and only once it has a commit of its
own. Nor does it offer a revert — git has no record of it to undo, and the
untracked revert removes a file, which a folder is not.

**How far each change has got, and whether the request is behind it.** One diff
against the merge base is one comparison, and it folds committed, staged and
unstaged work into a single pile — which is not the question a reviewer has once
a request is open. Two facts answer that one, drawn as two marks so that neither
hides the other.

The first is a ladder of three rungs, filled up to the one reached: **not
committed** (amber), **committed** (blue), **pushed** (faint). On a row it is the
dots alone, standing where a status letter used to, and the header stays one
line. The word on every row was a second line per file saying the same thing
down the whole column. What happened to the file moves onto its name instead — a new file's name is green, a
deleted one is struck through in red, the rest are plain — and both facts are in
the path's tooltip and read out after the row in words.
The furthest-behind rung wins, so a file committed once and edited again reads
"not committed", because committing it again is the work still to do. The second
is a red cloud, and only where the remote's copy of the branch already changed
that path: the request is showing an older version of this file, and somebody may
be reviewing it. It survives a rename, because rename detection prints only the
destination and the remote knows the file by the name it had.

**The list sorts itself by that ladder** — pushed first, then committed, then not
committed — so the bottom of the column is where the reader's own attention
belongs. A **stable** sort, so git's order survives inside each rung and a file
only moves when its state actually changes; and applied before the writers filter
narrows the list, so pressing a chip still never reshuffles anything.

A strip above the list carries the same three badges with a count and the word,
which is what makes it the legend for the rows rather than a second vocabulary.
It is meant to fit one line, so everything else on it is short: a red cloud with
the number of files out of date in the request, a faint "not on GitHub" when the
branch has no copy there, and **Push**, offered only where there is a commit to
send, with how many in its tooltip. The full sentences are the tooltips; the
cloud's also says what being out of date means and that pushing settles it. Pushing publishes nothing uncommitted, and a
button here that committed on the reader's behalf would be choosing a commit
message for them; that decision belongs to the pull request tab, which has a
field for it. The counts are taken over the whole branch and not over what a
writers chip left on screen: the strip answers where the branch stands, which a
way of reading the list does not change.

**With no commit waiting, the strip says nothing about it.** Zero means two
different things — on a branch with no copy on the remote the count is measured
from the base, and zero means nothing has been committed yet; on a branch that
has one it is measured from that copy, and zero means everything committed is
already there. One sentence for both once told a pushed branch that nothing was
committed yet, beside its own "2 pushed" badge; a sentence for each fixed that
and made those two sentences most of the strip. The badges already show what is
left to do, and silence cannot contradict them.

When the branch has nothing left to send, the strip says so in one line and
**the per-file marks are not drawn at all** — the same rule the writers mark
keeps: a mark on every row saying the same thing is noise, and the question only
exists where there is something to tell apart.

That is a fact about the **branch**, not a count of the rows, and the difference
is load-bearing. The list holds what differs from the merge base, so a change
that nets out against it is not in the list at all — reverting a pushed file
with the pane's own control is exactly that — while being precisely a change the
remote has not got. Counting `pushed` rows said "everything is on GitHub" over
an unsent revert and hid every badge that might have hinted otherwise;
`publish.ts` answers it instead from the reads that can see it, an amended
commit included.

**And none of it is said while `HEAD` is not on the workspace's branch.** Every
reading behind this strip is anchored on `HEAD` while the branch arrives as a
name, so with the two apart the copy of `work` on the remote is being compared
against a `side` that never had one. The workspace terminal is a shipped tab and
`git checkout` is one command in it, so this is a state the app offers a way
into. The strip says that and nothing else, and the rows lose their rungs with
it — two of the three rung labels are themselves claims about GitHub.

Deliberately **not** the "not on GitHub yet" sentence: the branch may well be
there, and reusing it would trade one false statement for another. The pull
request tab's _Commit & push_ refuses outright in the same state, which is the
half that was doing damage — committing lands on whatever is checked out while
pushing sends a name, so apart the two put the work on one branch and send
another, both reporting success.

**A project is allowed to have no remote.** A repository, a commit and a base
branch is all a project needs, so a local-only checkout is supported — and for
one, none of the sentences above is drawn and Push is not offered. "Not pushed
yet" and "there is nowhere to push" are different answers, and a band about a
service the project has nothing to do with can never come true or be dismissed.

**Colour says what changed; the code says what it is.** The row carries
`--diff-added-bg` or `--diff-removed-bg` and the sign in the gutter carries the
hue, but the text is left to the syntax highlighting. The chat's change block
colours the text as well and is right to — three lines with no highlighting need
the colour to say what they are — but the same green over a whole file drowns
what the code says. The two backgrounds are their own tokens rather than
`--success-bg` and `--danger-bg`: those were tuned to sit under their own status
text, and measuring showed a syntax palette losing about a tenth of its contrast
on them.

**Two gutters in one column.** A removed line has no number in the file as it now
stands and an added line had none in the file as it was, so a single gutter would
put a number on a line that never had one.

**Side by side** is a stored preference, and the width two columns need is
measured from a sample of the real monospace face — the cell differs by platform,
font and zoom. Below that width the toggle stays visible and disabled, saying
why, and the view falls back to one column without touching what was asked for.

**Syntax colours arrive after the diff does, and only for the files that are
open.** A side of a file is tokenised whole rather than line by line, or a
block comment is coloured wrongly from its second line on. Nothing waits for a
grammar: an unhighlighted line is drawn in `--ink`, and a highlighter that
never starts costs the reader only the colours. Every file starts folded, and
colouring both whole sides of each — a one-line edit in a 3 000-line file is
6 000 lines tokenised, on the main thread — spent the window on lines nobody
could see, on every read of the diff, which is every turn's end. So
`useHighlighting` takes the set of open paths beside the diff: a file is
coloured when it is opened, keeps its colours while the diff stands, and
"expand all" colours them all as it did before.

**And the whole side means the whole file, not the hunks joined up.** Joining
them left a construct opened in the gap between two hunks invisible, so the hunk
after it was coloured as though the construct were not open — most likely in
exactly the files worth reading closely: a hunk in the middle of a long
function, three lines of context either side, and everything that gave those
lines their meaning left out.

The sides come from one `git diff` with the context turned up past any file's
length, in the same read as the diff itself — one merge base, one copy of the
index, and no moment between the two for a file to change in. Measured: that costs the same 42ms as the
`-U3` the pane draws from — the cost of a diff is walking the trees, not
printing context — where a `git show` per file cost twelve times as much,
because each is a process. Past a megabyte the answer is empty and the colours
go back to the hunks, which is what they read before: colouring is a courtesy,
and a review of fifty files should not spend that over IPC on it.

Tokens then line up with lines **by number** rather than by walking, which is
the whole difference: the tokens describe every line of the file and the hunks
describe some of them, so there is no shared walk to keep in step.

**The pane can be opened on one file from outside.** The viewer's "Show changes"
hands it a path and a counter: the file is opened, a writers chip that hides it
is cleared (one it is already in is left), and the list is scrolled to its header
— once, on the first list that contains it. A request already standing when the
pane mounts is not replayed.

**Every file starts collapsed**, and what the core left undrawn is said in the
header rather than quietly appearing unchanged. Opening the tab shows the list,
not the lines: the reader picks what to read, and one long file no longer
pushes the rest out of sight. It used to be only files over 500 changed lines.
What the reader opens or closes is remembered **per workspace** for as long as
the window is open — a visit to another workspace no longer folds everything
back, and the same path there is another file, so it does not open with it. A
restart starts everything collapsed again; this is a way of reading, not a
setting.

**A character that does not draw as itself is named where it stands.** Text goes
on screen through the browser's bidirectional algorithm, so a right-to-left
override reorders what a reviewer reads without changing a byte of what the
compiler reads — the Trojan Source trick — and a zero-width character draws as
nothing at all. Nothing is executed: React escapes the markup, and the danger is
narrower and worse suited to being ignored, because the surfaces this happens on
are the ones where somebody authorises something: a pane whose only job is
checking work before it merges, and a card with an Allow button under a command
that is about to run.

Such a character is replaced by a chip naming its code point, `U+202E`, which
stops the reordering as well as reporting it — a marker elsewhere on the row
would name the problem and leave it standing. The file header carries a warning
too, since every file starts collapsed and an unread line is the one most
likely to be approved. The path gets the same treatment, being drawn from the
same bytes: a file can be named to read as an image while ending in `.js`.

U+200C and U+200D are deliberately left out. Persian and Indic text need them
and every multi-part emoji carries one, so warning about those is warning about
nothing by the second file. `shown` in `src/renderer/src/components/diff/shown.tsx`
is the one place this is decided, and the chat pane calls it for every plain
string the agent wrote: the permission card's command, the folded tool row, a
failure, a note against a plan, an error, and a question's options. `named` in
`invisible.ts` beside it makes the same substitution as a string, for a `title`
or anything else the DOM types as text — a tooltip is laid out by the same
algorithm as the row it hangs off, so leaving the raw string there would be the
same misreading with a delay.

**The card says why it is asking, where the bridge says.** `canUseTool`'s third
argument carries `decisionReason`, and until it was read a request that looked
identical to fifty silent ones had no explanation at all: under `acceptEdits`
an ordinary edit passes without a word and a file inside `.claude/` is asked
about, because the CLI guards the agent's own instructions separately. The mode
looked broken and nothing on screen could say otherwise.

Drawn in the bridge's own words rather than translated or replaced by ours: it
names a specific path and a specific rule, and the alternative is silence. The
heading stays ours, though the SDK offers a `title` and says to prefer it — that
sentence says what the tool name and the path above it already say, in English,
in a window that is not.

**"Always allow" is left off where the bridge forbids a standing answer.** The
CLI sets `suppressAlwaysAllowRule` when the rule that button would write is
wider than the question — and on those asks it names no narrow rule, so the
answer would have granted the whole tool. The card then offers Allow and
Decline only. **A question the bridge withdraws loses its buttons** the moment
it is withdrawn, rather than at the end of the turn, and reads like any other
settled card.

The permission card is the strongest case rather than the diff pane. It is the
one place somebody authorises a command to run against their working tree, and
answering "Always allow" there writes the tool _name_ — so a misread line
approves every future call of that tool, in every workspace.

**Markdown has it too now, and the map is complete for that reason.**
`<ReactMarkdown>` offers no hook for text nodes — `components` maps element
types — so every entry that can hold text calls `shown` on its own direct
string children, and an element child names its own text through its own entry.
That works only if nothing text-bearing falls through, which is why `h5`, `h6`
and `del` were added: the element set is bounded and knowable, being whatever
`mdast-util-to-hast` emits for GFM with raw HTML off, so the map can be
exhaustive and is. Those three had been reaching the document through the
browser's own sizes, which is the very thing the map exists to prevent.

The chip sits inside a heading, a table cell and a fenced block without
breaking any of them, which was the open question. In a fenced block it changes
what Copy puts on the clipboard — `CodeBlock` copies `textContent`, so what is
copied is what was read, the same trade-off the diff pane already takes.

**A note against the code rides out with the next message.** It becomes text —
the path, the lines, the code as it read when the note was written, then the
remark — above whatever was typed, because nothing implicit reaches the agent
(§4).

**A note about the file as it was says so, and a bare number would be wrong
without it.** The two sides of a diff are different lines even at the same
number, so `path:812` on a removed line addresses the file **before** the
change — code that is not there any more, and after a large deletion numbered
differently from everything around it. The quote rescues a distinctive line;
for `}` or `return null` the number is all there is. Translating the old number
into a new one is not on offer and is why the side is recorded rather than
resolved: a removed line has no line in the file as it now stands. The composer
chip carries the same mark, that being the last moment somebody can take the
note back.

**A note covers a passage, not only a line.** The trigger in the gutter takes
one line, and selecting code with the mouse takes as many as were dragged over:
a button appears at the selection and opens the same editor. One line is the
right unit for "this line is wrong" and the wrong one for a condition spanning
three, the two halves of a rename, or a block that should not be there — each of
which used to mean several notes and the hope that the agent joined them up.

**Both controls are filled with the accent.** The gutter's is a small `+`
square over the line numbers, shown under the pointer and on keyboard focus, the
way GitHub draws it; the selection's says **Add to chat** in words and is the
file viewer's toolbar button, so the two ways of pointing at code read as one
feature. Both started as faint outlined icons, which people under the pointer
still missed. The selection's button starts at the selection's left edge rather
than centring on it, and keeps clear of the window's edge.

The selection is trimmed to the file and the side it **started** in. Dragging
past the end of a file is how a reader selects the end of a file, and a gesture
that answers nothing because it went one line too far teaches people to drag
carefully rather than to select what they mean.

**Whole lines are quoted, even from half a selection.** Half an expression
without the line around it is precise about the wrong thing, and the note is
read by an agent that has to find the code again. The quote comes from the diff
model rather than from the screen: `shown` replaces invisible characters with
visible `U+202E` badges, so the text in the DOM is deliberately not the text in
the file.

**One passage takes one note**, which is what `anchorKey` spells — path, side,
and both ends. Two passages may overlap, which the single-line rule this
replaces could not: refusing the second would mean deciding which of two
overlapping selections wins, and neither gesture asks that.

The rows carry their own address in a `data-line` attribute, since a browser
selection knows about nodes and offsets and nothing about the model that drew
them. It sits on the code rather than the row: the gutters are `select-none`, so
a selection is always inside one, and side by side draws two per row addressing
different files.

**Every prop a file is handed has to hold still.** `DiffFile` is memoised, and
that is not a micro-optimisation: highlighting arrives one file at a time and
the pane's width changes on every pointer move of a drag. Each of those used to
redraw every file, every hunk and every row — and a redraw drops a live text
selection, which is the thing the note button acts on.

So the pane hands down `useCallback`s and a `useMemo`d comment surface, and the
draft being typed is kept in a **ref** rather than in state, precisely so a
keystroke does not rebuild the surface and redraw the diff per character. An
arrow function written inline in the file list is enough to undo all of it, and
nothing about the pane looks wrong when it happens.

Two tests guard the two halves, and neither is sufficient alone.
`DiffFileMemo.test` builds steady props by hand and checks a file ignores its
parent's render; `DiffPanelMemo.test` drives the pane with the props `App`
actually holds still and counts what it redraws. The first holds whatever the
pane passes, so only the second can see the pane passing something new — and a
test of this has to hold still exactly what `App` holds still, or it measures
itself.

**Revert, on each file's header.** The one destructive control in the pane, so
it is named after its file rather than "Revert" — twenty buttons sharing one
name identify nothing to anybody reading through a screen reader. It puts that
file back to the state the workspace branched from, which is the pane's own
scope, so the row leaves the pane. It always asks first, and what the dialog
says is the asymmetry: committed work survives, undone by a change in the
working tree, while uncommitted work is gone and nothing in git holds a copy.
An untracked path already gone counts as reverted; one that could not be
removed — a folder, a file this user may not delete — says so in the banner
rather than letting the row come back as though the click had worked.
