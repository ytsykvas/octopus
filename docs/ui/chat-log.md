# The conversation log

The chat is shaped like **Claude Code's own transcript**: what the agent said as
prose, and every tool call as **one row** with what came back under it. A turn
is mostly tool calls, and folding them into the prose — or into a count of them,
as the log once did — hid the part that says what the agent actually did.

```
▸ ● Read  src/App.tsx
    ⎿ 1 210 lines
▸ ● Bash  npm test
    ⎿ ✓ 147 passed
      … +12 lines
▸ ● Edit  src/App.tsx                 +3 −1
    ⎿ (the first ten lines of the diff)
```

The mark is a spinner while the call runs, a dot once it answered — red for a
failure, hollow for a call the turn ended before answering (`settled`: an
interrupt leaves no answer and no work either). The line under the row says
what came back in the fewest words that are true: the lines a `Read` returned,
the files or matches a search found, the first four lines of a command's
output and how many more, a fetch's first line, how many tools a subagent used.
The counts come from the tool's structured output where there is one
(`stats`), and never from parsing its prose.

**Every per-tool decision is in one table**, `toolViews.ts`: what a row names,
the line under it, what opening it shows. The row itself knows no tool by name,
so adding a tool is one entry, not three `switch` statements kept in step by
hand. A tool without an entry — an MCP tool, one the SDK adds later — gets the
first field that reads as a target and the head of its output.

**Clicking a row opens it**: the input where the row could not say all of it
(the whole command, the arguments of a search or an MCP call), the whole output,
paged two hundred lines at a time inside a box of its own, and for a subagent
its steps and its report. **⌘O, or the button floating at the top of the log,
opens every row and all the reasoning at once** — Claude Code's ctrl+o. A row
opened or closed by hand keeps that only until the next press (`Expansion`'s
`generation`), so "show everything" shows everything. Per conversation and in
memory only: a log reopened fully expanded would mount every diff in it at once.
A dialog that is open keeps ⌘O, and a conversation behind a file does not hear
it.

That button, the floating day chip and two more share one sticky row, a grid
column each, so the chip cannot draw over a button in a narrow pane. The two at
the right, **↑ and ↓, step between the user's own messages** (`useMessageSteps`,
reading `data-user-message`): up to the last one above the line just under the
row, down to the first below it. Instant rather than smooth, so a second press
measures from where the first landed. Each is disabled with nowhere to go,
including at either end of the log, where the first and last messages can never
reach the line; disabled through `aria-disabled`, so a key pressed until the end
keeps its focus. A log with no message from the user shows neither. The row is
re-read on scroll, on a new entry, and on any resize of the log or its content.

**The log opens at its end and keeps to it** while the reader is there. Two
things used to undo that. A hidden tab is `display:none`, and hiding it resets
the scroll and fires a scroll event with no height behind it — read as the
reader leaving the end, it stopped the following for good, so a conversation
came back at its top. A scroll with `clientHeight` 0 is therefore ignored. And
rows grow after they are laid out (markdown, code), so the one scroll to the
end landed short; a `ResizeObserver` on the log's content scrolls again while
the reader is still pinned. More than one screen above the end, a small round
accent button with a cloud-and-arrow icon floats at the bottom-right of the
log; it jumps straight to the end and pins it again. The log never scrolls
sideways (`overflow-x-hidden`): code, tables and diffs scroll inside their own
box, long message text wraps, and a tool row's path truncates.

**A path in a row opens the file in the centre**, the way the right pane's tree
does: a click previews, a double-click keeps it. The agent names absolute paths
and the tabs relative ones, so `workspaceRelative` takes the workspace off — and
a path outside the workspace stays text rather than offering a click that could
only fail. The core checks containment again when the file is read.

**Reasoning is folded to one line** and opens with a click or with ⌘O.

**While a turn runs, the line under it counts its seconds** — "Working… 12s" —
and stays while the answer streams in, as the CLI's spinner does: text
arriving says the agent is talking, not that the turn is over. It holds its own
clock, so the tick redraws that line and never the log. It does not say
"esc to interrupt": Escape stops a turn only from the composer.

**A sent message carries its hour, and each day opens with a chip.** The hour
sits under the bubble in faint 24-hour figures (`14:32`), always visible, with
the full date and time in its tooltip — the same 24-hour, day-first reasoning
`formatResetAt` gives. The first message of each calendar day, in the reader's
time zone, opens with a pill saying "Today", "Yesterday" or the date, the year
only once it is not this one's. The label is worked out when the pill is drawn
and only the day's key is held with the message, so a chip that said "Today"
says "Yesterday" tomorrow. An agent turn that runs past midnight is dated where
it began: a mark in the middle of one turn would split an answer from its
question. Once a day's own pill has scrolled off the top, a copy floats there,
as a messenger's does — read off the separators' positions on each scroll
(`useDayAtTop`), since a sticky separator could never leave the message that
holds it.

**A message sent while the agent works says "Queued" beside its hour until the
agent takes it.** The CLI holds such a message in its queue and folds it into
the running turn between tool rounds, or starts a turn for it once the current
one ends — measured on a live session, seconds after it was sent. It says so in
`command_lifecycle` frames, which `mapMessage` turns into `message_queue` and
`useChat` keeps as a set of message ids; a turn ending empties the set, so a
mark cannot outlive the session that held its message. A message is marked only
once it has waited a quarter of a second: every message passes through
`queued`, one sent to an idle agent for two milliseconds, and marking at once
would flash the word under each of them. Its tooltip says what
Stop does not do: an interrupt leaves a queued message in place (the receipt
lists it under `still_queued`) and it then runs as a turn of its own — which
the tab shows as running. The core counts the messages a session holds
(`heldMessages`): a successful result with one still held leaves the chat
`running` instead of writing `idle` and then `running` a state write later,
and `started` for a message sets it `running` too (`handleEvent`). Before,
only a send did, and the agent worked under an idle tab with no Stop. The
protocol can cancel it, but the installed SDK offers no typed call for that, so
the mark tells the truth rather than Stop pretending to do more.

**A failure's head stands under its row, and the whole of it is a click away.**
Where a failure has no row to sit under — the answer to a call no longer in the
log — it is drawn on its own, **shortened from the middle.** It is the row the user
has to act on, so it is not summarised away — but it cannot be unbounded either,
and where it is cut decides what survives. A validation error names the rule at
the start, spends the middle on the value it refused, and says what to do at the
end; cutting the tail throws away the half that answers "and now what". So the
two ends are kept with a marked gap between them, rather than the first 400
characters ending mid-word as though the message had finished there. The agent
side's own `<tool_use_error>` envelope is taken off first — each half
independently, because a message already shortened upstream arrives with an
opening tag and no closing one.

**What the agent says is drawn as markdown**, through the same component that
draws a plan. The model writes it, and shown as characters it is punctuation in
the way of the words: `**7/10**` read as asterisks, a command came with its
backticks, a list was a column of hyphens. A fenced block in an answer therefore
arrives framed and with its copy button, and inline code as a chip.

**What the user typed is the one place markup stays text.** Those characters
came from the composer, and drawing their asterisks as bold would make the log
disagree with what the person wrote — the agent's prose is output to render, the
user's message is their own words to quote.

Text streams in as it is written. The finished block replaces the fragments when
it arrives; only the finished one is stored (see [data/transcripts-and-ports.md](../data/transcripts-and-ports.md)).

**The line closing a turn** carries how long it took, the tokens the whole
exchange took — prompt and reply as one figure, since the question and its answer
are one thing — and why it ended — the last only when it did not simply finish, since a row saying
"completed" beside a tick is the same thing said twice. It carries no price. The
SDK's `total_cost_usd` is what the same tokens would have cost through the API,
which a subscription never pays, and it is cumulative across the session besides:
on a row it would read as the cost of that turn while meaning the running total.
A made-up number in a currency, in a place the eye trusts.

**The conversation is capped at 72rem** — the log, the composer and the error
banner between them, or they stop lining up. The banner sits directly above the
composer, outside the scrolling log: as the log's first child it was thousands of
pixels above the screen in any long conversation, and a send that failed looked
like an agent that never answered. A ceiling rather than a width: it
only applies once the panes are dragged that far apart.

**The composer's two rows wrap rather than overflow.** The centre reaches
`MIN_CENTRE_WIDTH` (360, in `RightPanel.tsx`) — by a drag, or by a narrowed
window, which the centre absorbs before the right pane gives way — and at that width the
footer cannot hold its three settings and the send button side by side. It used
to run past the rounded border and take the send button off the edge of the
block — Enter still sent, but the pane's primary control was not on screen. Each
control carries `min-w-0` rather than `shrink-0` for the same reason: `truncate`
on its label could never fire while the button refused to shrink. What gives way
is the wording, and only after the row has already used a second line.

**A draft belongs to the conversation it was typed in.** The whole chat pane is
keyed by the workspace, so a switch takes the field with it — along with the
highlighted command and the dismissed hint, which are derived from the text and
would otherwise point at words that had gone. Typing an instruction in one
workspace, looking at another and pressing Enter used to send it to that agent,
in that worktree, on that branch, with the text still in the field saying
otherwise.

The text is kept per workspace **and tab** rather than thrown away, in a map
`App` holds beside the review notes: going to look at something should not cost
a half-written prompt, and a sentence typed for one conversation is not for the
one beside it. Keyed by the tab's key rather than by its chat id — the id
appears with the first message, and a draft filed under the old key would be
lost at exactly that moment. The composer hands it up **once, on the way out** — a
report per keystroke would put a `setState` in `App` under every key pressed,
with the log re-rendering behind it.

**The stop button follows the conversation, not the pane.** `busy` is this
pane's own events **or** the conversation's status, so a turn left running is
still stoppable when you come back to it. The conversation's rather than its
workspace's, which is what it read before there could be more than one: three
tabs share a workspace, so the one that finished reported the other two idle and
took the stop button away from turns still going. Derived rather than seeded on the switch:
the event that ends a turn is filtered by the open chat's id and there is no
chat until its history has loaded, so one arriving in that window is dropped and
a seeded flag would stay stuck on.

**The log is drawn through assistant-ui's thread and message primitives.** Each
turn — what the user said and everything the agent did in answer — is one
message in an external-store runtime fed from the transcript, and each block
rides in as a `data` part carrying itself. Nothing is mapped onto the library's
own `text`, `reasoning` or `tool-call` parts, and that is deliberate: the log is
shaped by rules the library has no word for (a call and its answer as one row,
a subagent's steps inside its call, an edit drawn as a diff, an answer struck
through because the agent took it back), all of which live in the block, and translating would encode them a
second time and be wrong about them in one of the two places. So the library is
the runtime and the structure — messages, parts, the place later features such
as per-message actions would attach — and the rows are ours.

What the library is handed has to keep its identity. It caches a message by the
object it was given and the part renderers by the object they came in, so a map
or an arrow function rebuilt inside the render makes every row re-render by
itself: measured under jsdom, 592 ms for one update at a thousand turns with
them inline and 18 ms with them hoisted. The part map, the message renderer and
the converter are module constants, and `toThreadMessages` hands a turn over as
the same message for as long as its blocks are the same objects — which
`buildBlocks` sees to by wrapping each entry and each call once (`logBlocks.ts`
keeps the wrappers in `WeakMap`s, as it already kept the calls). Measured under
jsdom at 600 turns, one line appended to the log cost 188 ms with every message
rebuilt, 70 ms with the blocks stable and the messages still new, 10 ms with
both held: the library converts and re-walks every message it has not seen.
Token streaming never goes through the runtime, which also sidesteps an open
upstream issue where the cost of each update grows with the thread's length.
Nor does it go through the log's props, nor through anybody's state:
`useStreaming` gathers the fragments and publishes them every 50 ms into a
store of the conversation's own, which `StreamingContext` carries and only the
tail below the thread reads, through `useSyncExternalStore` — so a flush
renders that tail and nothing else, where as state of the hook it rendered the
whole pane, composer and pickers included, twenty times a second. The hook's
own state says only whether something is being written, which is what the
empty placeholder asks. A pane nobody can see — behind another tab, behind a
file — gathers and draws nothing, and draws what gathered the moment it comes
forward. And past 1 500 characters the tail itself is drawn in two parts
(`streamedText.ts`): everything up to the last blank line that precedes a
paragraph or heading, outside any fence, parsed once and kept by `Markdown`'s
memo, and the moving remainder — so a long reply no longer costs its whole
length at every flush. The final text arrives whole in its own event and is
parsed whole. Dependency pinned to an exact version: it is 0.x and its minors
have broken things.

The rows' own props travel in a context, built once per change of anything in
it: what the rows share — the answers by request, the calls that were plans,
what the agent took back — is gathered from the whole log on every append and
handed on as the object it was last time while it reads the same
(`useSameValue`), so a line appended at the end leaves every row above it
alone, and the turn ending redraws them all, once. The log itself is memoised,
and `ChatSession` holds every prop it hands it still, down to the announcer
`useChat` is given for a record it creates, which the pane writes inline and
the hook keeps in a ref: taken as it came, it made every setting's callback —
and the log's "carry out this plan" — new on each render of the pane. `Markdown`
is memoised on its text, so a row drawn again does not parse it again; parsing
was what a poll or a token used to cost across the whole conversation.
`ToolRow` is memoised on its call and the turn's state, and reads what it needs
to open a file from a context held still, so a streamed token leaves the tool
rows alone. Whether the log is expanded is a context of its own for the same
reason: it changes on a press, not per render.

The tasks beside the conversation are the one thing that moves while nothing
is appended: progress arrives for every working agent up to five times a
second. `AgentsContext` therefore holds still — the pane's three callbacks and
a store (`agentTasks.ts`) the pane publishes each list into before the paint —
and every reader takes what it draws through `useSyncExternalStore`: a tool row
its own task, the chip and the map the list, the working line under the log
the count of agents away. A row is redrawn when its task is a different object,
which the core sees to only when the task moved; the log, which used to read
the list itself and redraw every row with each arrival, no longer reads it.

**Not moved: the composer.** The slash list and the `@` list were built here, on
the field's own keys, with the draft kept per tab, an IME guard on every key, a
pasted image, a dropped file and the caret put back after a mention. The
library's composer primitives would replace all of that with its own handling of
each, for no behaviour the field lacks, and the tests that pin those behaviours
describe this field, not that one. If a feature ever needs what the primitives
offer, the seam is `ChatSession`: the runtime already lives one level down.

**A move into another worktree is a line, not a tool row.** The agent is offered
`EnterWorktree` and `ExitWorktree`, and either moves its working directory away
from the workspace's worktree while Changes, Files, the terminal and the scripts
stay on it. Drawn as a tool row the call was a name with nothing readable beside
it, so it is said in the warning colour instead — where the agent went, by the
name or path it asked for, and whether it kept or removed the worktree on the
way back — and never drawn as a tool row. Not refused: octopus is a
harness, not a filter. The line is drawn from the call, so it says what the
agent is doing rather than what happened: the CLI asks permission for a path
outside its own worktrees and refuses a removal with uncommitted work on
purpose, and either answer is the line below it. A move with neither name nor
path says "a new worktree", since only the result knows the name the CLI made
up. A subagent's move stays a step inside its row: it moves the subagent only.
**A `cd` in the shell is the other way the session moves, and it is a line of
its own.** The CLI keeps the directory a Bash command ends in as the session's
working directory, and nothing in the call says where that was. Its
`CwdChanged` hook does: handed to the SDK as a callback (`cwdWatch` in
`agent.ts`), it fires after each shell command that moved the session —
measured on SDK 0.3.307 (CLI 2.1.307) on a `cd` into a worktree, back out of
it and away from the repository, and **not** on `EnterWorktree` or
`ExitWorktree`, which stay drawn from the call. The callback runs only
beside a command hook for the same event in the session's settings, which the
session carries for that reason alone (`CWD_WATCH_SETTINGS`, `docs/core/agent-sdk.md`).
The hook becomes a
`cwd_changed` event, kept in the transcript, drawn in the same warning register
as the worktree line: the path from the workspace's root when inside it, whole
when outside, and "back in this workspace's worktree" for a return to the root.
A subagent's `cd` is left unsaid — it moves the subagent, which ends with its
task. What notices the next tool whose call is a move is a test:
`toolSummary.test.ts` classifies every name in the SDK's `BUILTIN_TOOL_NAMES`,
so a tool the SDK adds to that list fails the typecheck until somebody says
which it is.

**A subagent's work is inside the call that started it.** Its messages arrive on
the conversation's own stream, told apart only by the id of that call
(`parentToolUseId` on its text, reasoning, calls and results), and drawn at the
top level a long delegated task buried what the conversation itself said. The
call is one row saying how many tools the subagent used; opened, it holds the
subagent's own calls as **the same rows a level down** — edits with their diff
included — one line of each remark, and then **its report** as markdown. One
nested inside another nests the same way. While it works, the row's line names
its latest step, the one sign with the row closed that something is happening.

The report is the subagent's own words, from its structured output (`report`),
because the result's text carries the CLI's trailer after it — the agent's id
and a usage block meant for the model. A subagent sent off to run on its own
answers its call at once, and its row says it is running in the background.
That answer is the CLI's launch notice — metadata it asks never to be quoted —
so it is never drawn: the report arrives with the task's end
(`task_notification`), and the opened row takes it from the task once it is
over. While it works there is no report to show, only its steps.
A step whose call is not in the log (a conversation cleared halfway) stays at
the top level rather than vanishing.

**The plan can be rewritten before it is approved.** The dialog's `Edit`
swaps the rendered plan for its markdown, in a monospace field, and back; the
edits are kept when the field is closed to look at the result, and held by the
pane keyed by the request, so a plan the agent replaces mid-edit does not
inherit them. Execute is disabled while the field is empty: an emptied editor is
not a plan, and approving the original under it would do something the field
plainly says it is not doing. Executing then
sends the user's own text, and the agent works from it rather than from the
words it wrote — it rides the reply that releases the tool call, since nothing
else reaches the plan. An untouched plan, or one put back as it was, goes as
`null`, so the agent is only told a plan is different when it is; an emptied
field is not a plan and is not sent. A rewritten plan gets a block of its own in
the log, named "Plan, as you edited it", under the one the agent wrote: the log
has to say what the agent was actually told to do. Rewriting is the whole-plan
alternative to the feedback field, which sends the plan back to be reworked.

**A message offers to rewind to before it** — the conversation, the files, or
both, the three Claude Code's own `/rewind` offers. Hovering a message the user
sent reveals a small undo mark beside it. Two steps, and the first changes
nothing: the core is asked what each half _would_ do, so the dialog's rows carry
the numbers ("puts 3 files back … +12 −4") and picking one is the confirmation.
A choice that cannot be had stays in its place, disabled, with the reason — the
conversation was compacted since, or forked from another, so the agent no longer
holds that point; another conversation of the workspace is working, so the
files cannot be touched; the agent refused, in its own words; or the files are
already as they were. A row that vanished would read as a feature that is not
there, and the reason is the one thing the user can act on. While the files are
on offer the dialog says once what the numbers cannot: anything changed in them
since — by the agent or by the user — is overwritten.

Rewinding the conversation drops the message and everything after it from the
log and from what the agent remembers, and puts the message back in the field,
replacing whatever was there, with the caret at its end — to be edited and sent
again, as Claude Code does. Every window holding the log reads it again from
disk; one whose tab has moved to another conversation by the time that read
comes back drops it rather than draw the old log into the new one. The log
scrolls to its new end, and the context gauge reads again: the session it was
reading from is closed by the cut, and the next one starts from the shorter
history. Putting the files back adds a quiet row to the log, because the tree
changed without the agent doing anything, and it says how many
files a link kept it from restoring, since the rewind never follows one. The
files are refused while **any** conversation of the workspace is working, not
only this one: the worktree is shared. The mark is absent while the agent is
working (the core would refuse it, and a button that can only fail is a promise
the interface does not keep) and on messages sent before their ids were kept.
The files need checkpointing, which every session is started with — a
checkpoint cannot be taken for work already done, so conversations that ran
before it have none.

**A refusal that swapped the model gets a line**, in the same quiet register as
the compaction and reset lines and for the same reason: something happened to
the conversation that nobody in it asked for, and the turn above reads as an
ordinary one without it.

Two sentences, not one. A `session` swap outlives the turn and the composer's
chip has already moved, so the line is what explains a chip that changed on its
own; a `local` one was a subagent or a side question and the chip has not moved,
where saying "the rest of this conversation" would send the reader after a
change that is not there.

The refusal's own words go underneath when there are any, drawn exactly as
given: the SDK calls that field "unstable human prose — display only, never
parse", so it is shown and nothing is read out of it. Absent more often than
not, and an empty line under the sentence would read as prose that failed to
load.
