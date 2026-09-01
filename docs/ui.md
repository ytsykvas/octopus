# The interface

## The window

```
┌──────────────────────────────────────────────────────────────────────┐
│ ●●●   sport   /Users/…/sport                                      ⊞  │  title bar
├────┬──────────────┬──────────────────────────┬──────────────────────┤
│ TG │  sport       │                          │ Changes Terminal …   │
│ SP │  ⑂ develop   │        agent chat        │                      │
│ OC ├──────────────┤                          │                      │
│    │  ● anna      │                          │                      │
│ +  │  ○ maria     │                          │                      │
│ ⊟  │              │                          │                      │
├────┴──────────────┤                          │                      │
│ ⚙  Settings       │                          │                      │
└───────────────────┴──────────────────────────┴──────────────────────┘
  tabs   workspaces           centre                 right pane
```

**One title bar across the window**, not one strip per pane. Each pane used to
draw its own, which pushed the tab strip's fill up behind the traffic lights and
put the project name under them. Its left padding clears the buttons outright,
so nothing depends on how wide the tab strip happens to be.

**Projects are a tab strip**; workspaces are a list of the active one. Conductor
puts both in one tree, which outgrows the window and makes a click mean two
things — select and fold. Splitting them means neither list grows with the other.

**The fold sits at the foot of the strip**, as an icon. The strip is the part of
that column which survives folding, so the control that brings the list back
belongs to it rather than to the pane it hides — and it sits below the scrolling
list of projects, or it would scroll out of reach once there are enough of them.
What stays in the corner underneath is Settings, which belongs to the window
rather than to any project.

**The centre is the agent chat**, scoped to the selected workspace: its worktree
is the agent's working directory and its branch is where the work lands. A
different workspace is a different conversation, not a continuation. Without one
the pane is not the chat at all but an empty state that offers to make one — see
"Empty panes" below.

**Its header is the strip of conversations**, and nothing else. A workspace holds
up to three, and they run at once in the one worktree.

The branch used to be here, marked with a branch icon, and has moved to the
title bar beside the project's directory: it says where the work lands, which is
a fact about the window rather than about any one conversation, and it was
spending a 36px row on one short string. The centre is the narrowest pane in the
window, so a row is worth having. The header's contents are capped at the same
72rem as everything below, or the strip would not line up with the log it
labels.

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
answer, danger for a turn that failed. Quiet is two states rather than one —
green where a session has run and finished, and a hollow dot where nobody has
written yet. Both are `idle` and the status alone cannot tell them apart, so
`started` comes along beside it: a conversation that did its work read as
untouched, which is the thing a glance down the list is most often trying to
settle. The hollow dot is drawn rather than left out, or the strip would shift
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
emptying the only one is `/clear`. Closing a conversation that has said
something asks first, because it deletes a transcript nothing can bring back.

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

The chat draws **one row per event**, not one bubble per turn. A turn is mostly
tool calls, and folding them into the prose hides the part that says what the
agent actually did to the working tree. Reasoning is folded away, a successful
tool result is not shown at all — the output of a `Read` is the file, and pasting
it in would bury the conversation in the codebase.

**A failed one is shown, and shortened from the middle.** It is the row the user
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
it arrives; only the finished one is stored (see [data.md](data.md)).

**The line closing a turn** carries how long it took, the tokens the whole
exchange took — prompt and reply as one figure, since the question and its answer
are one thing — and why it ended — the last only when it did not simply finish, since a row saying
"completed" beside a tick is the same thing said twice. It carries no price. The
SDK's `total_cost_usd` is what the same tokens would have cost through the API,
which a subscription never pays, and it is cumulative across the session besides:
on a row it would read as the cost of that turn while meaning the running total.
A made-up number in a currency, in a place the eye trusts.

**The conversation is capped at 72rem** — the log, the composer and the error
banner above them all, or they stop lining up. A ceiling rather than a width: it
only applies once the panes are dragged that far apart.

**The composer's two rows wrap rather than overflow.** The centre reaches
`MIN_CENTRE_WIDTH` (360, in `RightPanel.tsx`) — by a drag, or by a window
narrowed past what the right pane can give up — and at that width the
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

**The composer has an attic**, a strip above the field mirroring the settings
footer below it: how full this conversation's context window is on the left, and
on the right the skills it may reach for, a paperclip, and a refusal when the
account has one. The reading is one step fainter than the pickers underneath,
which are clicked where it is mostly read — mostly, because it is also the way
out of what it reports.

It used to be one figure in the chat header, and it was almost always blank.
Measured against a live session, `rate_limit_event` usually carries no
`utilization` at all — a status, a reset time and one window's name — and a
single event can never hold both windows anyway. The attic asks the running
agent instead, which answers with both.

Two rules there are worth keeping:

- **The strip used to vanish when it had nothing to say**, and that was right
  while everything on it was a measurement: an empty rule above the field would
  have been chrome asserting a reading exists. It carries controls now, and a
  control that comes and goes with an unrelated number is worse than a strip
  that is sometimes half empty. So the readings still vanish one by one and the
  strip itself stays. The rule that replaced it is the general one: **a
  measurement hides when it has nothing to say, a control does not.**
- **The reading never enters the log.** It arrives on the same stream as the
  agent's own output, and was appended there like anything else for a while:
  that wiped the answer being typed out, and left a row that draws nothing in
  the middle of a run of tool calls — splitting one fold into two, with a break
  the reader cannot see. `isEphemeral` in `core/events.ts` names the
  events that are not part of the conversation — the two streamed fragments, the
  rate limit, and the command list — and the log drops every one.
- **A refusal is named beside the numbers, never over them.** The first attempt
  had the account's status replace the percentages, which is what the old header
  chip did — fair there, where one number gave way to a word. Here it covered
  the two shares the strip exists for, and said less than they did. So only
  `rejected` gets a word now, because "the next turn will not run" is something
  no percentage carries; `allowed_warning` gets none, since "close to the limit"
  is vaguer than "Week 84%" and the colour already says it.

**Clicking the context share opens the two commands that change it.** It is the
one figure on the strip that can be acted on — the account's windows empty on a
clock nobody here controls — and what acts on a full context window is
`/compact`, which keeps a summary and carries on, or `/clear`, which throws the
conversation away. Neither is dispatched: they go out as the text of an ordinary
message, which is what a slash command is in this app, so the menu hands them to
the same `onSend` the field uses.

Two commands are noticed on the way past, both in `core/chats.ts`.
`isClearCommand` only watches — the message still goes, and knowing it went lets
the service drop the transcript when the reset comes back. `isUsageCommand`
takes the message instead: `/usage` is answered from the session's structured
reading and never reaches the CLI, because the CLI's own answer is a paragraph
of prose about percentages. It is drawn by `UsageCard`, the only place in the
app that shows the session's cost.

Three things about that menu:

- **`/clear` asks first**, and is the row drawn in `danger`. Typing the command
  asks nothing and still will — the question is there because a menu is reached
  by a stray click in a way a typed command is not, and what is lost is a file
  on disk rather than a screenful.
- **Nothing is disabled while the agent works.** The field beside it has no such
  check either: `Composer.submit` looks at the draft and nothing else. A menu
  stricter than the control next to it would be two answers to one question.
- **The reading keeps its measured tone through hover and while the menu is
  open.** `hover:text-ink` from the pickers below is the one line that must not
  be copied up here: `usageTone` paints the figure at 60% and again at 80%, and
  a hover that repainted it would put the control's state over the measurement.

**What the agent looked at folds; what it changed does not.** A run of tool
calls becomes the count of them, closed, opening on a click — the same
disclosure reasoning gets. A turn is mostly tool calls; one rename went through
fifty-nine, and a line each buried the two things worth reading. A lone call
stays in the open, since "1 step" costs more to read than the row it replaces,
and a failure or anything the agent said breaks the run so it stays where it
happened.

**A turn's footer needs a turn.** One at the head of the log has nothing above
it to close, and `/clear` used to leave exactly that: the transcript went with
the reset and the command's own result landed a tick later, so an emptied
conversation opened on a row reading `0.1s · 0 tokens` — three facts about a
turn nobody could see, and clearing again only replaced it. `service.ts` no
longer writes that entry; this rule is what the transcripts already carrying one
need, and it is why `groupToolRuns` skips rather than filters — position is a
block's key, and the entries after the footer have to keep the indices they had.

**An edit is drawn as the edit**: the path, `+8 −2`, and the lines themselves,
removed in `danger`, added in `success`, the untouched ones between them plain.
`Plan` is likewise never folded — it arrives as a tool call and is the substance
of the turn.

Three things about that diff are worth knowing:

- The change itself is read from the **call's own arguments** — an `Edit` is
  handed the text it replaces and the text it writes. A `Write` is reported as
  all additions, because what stood there before is not in the call and a
  "before" invented for a tidier diff is the one part the reader could not check.
- **The lines either side are read from the file the moment the edit succeeds**,
  and kept. Looked up when the conversation is drawn they would be wrong: a later
  edit shifts every line after it, so the context would surround wherever that
  text has since ended up. Recorded once, it stays true — and it arrives as its
  own event a moment behind the call, because reading a file is not something
  the event handler can wait for without letting events overtake each other.
- **A removed line carries no number.** It belongs to the file as it was, which
  is not something we kept, and a number there would be out by everything the
  change added. Where no context was recorded — a `Write`, a file since changed,
  an older transcript — the numbers are left off altogether rather than started
  from one.

The block is capped and scrolls rather than folding: the median change is two
lines, so a click would cost more than it saves, while a file written whole runs
to hundreds and must not push the conversation away.

**Permission requests appear in the log**, where the user is already looking,
with allow / always / decline. A request read back from the transcript shows no
buttons: it was answered long ago, and offering them would let someone answer a
question nobody is waiting on.

**A question the agent asks gets a card of its own**, with the options it
offered, what each one means, and a field for saying something it did not think
of. It stays in the log rather than becoming a dialog, and for the opposite
reason to the plan below: the answer belongs to the conversation and is still
worth reading a month later, and a modal would cover the very context the choice
is made from. Read back from the transcript it shows what was picked — which is
why the answer is recorded as an event, since the call above it holds the
questions as they stood before anyone answered.

The preview an option may carry opens under whichever option is being looked at,
following the pointer and the keyboard rather than the selection: it is there to
compare options while choosing, and four mock-ups open at once is a wall rather
than a comparison.

**Skip** is not a refusal. It approves the tool with its arguments untouched, and
the agent reads that as "nobody answered" — its cue to ask again rather than to
guess. Declining outright is not offered at all: a question is not a permission,
and the agent reads a refusal as instruction.

**A finished plan gets a dialog instead**, and the request that carried it draws
nothing in the log at all — the plan is already there, from the `ExitPlanMode`
call it arrived in, and a card would be the same text a second time under a
second set of buttons.

It is the one permission worth interrupting for. A plan is the substance of the
turn, and as a strip with two buttons on it the whole thing was read past on the
way to one; what the agent did next was start editing files.

**One button and a field**, which is what the question actually has:

- **Execute** runs it, in the mode the composer's footer names. The button used
  to name that mode as well, and no longer does: the footer is what the session
  actually runs under, it is on screen behind the backdrop, and a second place
  for the same fact is a second place for it to go stale.
- **The field is how you carry on planning.** Writing in it _is_ that, so a
  button saying so was the same decision offered twice. `Enter` sends and
  `⇧Enter` breaks the line — the composer's keys, one convention rather than
  two. The note reaches the agent as the refusal's reason, so "add a step for
  the tests" comes back as a better plan rather than a stopped conversation, and
  that plan raises this dialog again.

Dismissing sends whatever is in the field, empty or not. The agent is blocked on
this answer, so a dismissal that resolved nothing would leave the conversation
waiting on a question no longer on screen.

**The footer names what the next message will actually run in.** A conversation
with no record yet has no stored mode, and the record is created from the
settings — so that is what the pickers show until it exists, handed down from
`App`, which is where the config is read. Showing the schema's own defaults
instead made the control lie about exactly one message: the first, which is the
one the user has not sent yet and is looking straight at.

Neither picker offers to say nothing. The effort control had an `Agent decides`
row, stored as null — a control naming a level nobody had sent, which is the
same lie one step further out. A new conversation starts on `medium`, the
setting in Settings names a level too, and the level on the button is the level
the session is given. The one level always offered is the one in force, even by
a model that does not list it: it is what the next message runs with.

**Effort is a scale, not a list.** It is one ordered axis — `Faster` at one end,
`Smarter` at the other — and the menu that drew it as five unrelated words said
nothing about that ordering or about how far along it you already were. So the
chip opens a panel holding a horizontal rule with a notch per level, and the
marker is dragged along it, clicked onto a notch, or moved with the arrow keys.

The scale is only as long as the model can go: a level the model does not list
is dropped rather than greyed, because a notch that cannot be reached is a step
to nowhere. Past either end there is no notch at all, so `End` on the last one
reports nothing rather than a change to what is already in force.

**`ultracode` sits past the end, behind a gap.** It is not a sixth amount of
thinking: the SDK spells it as a flag standing beside `xhigh` — that effort plus
dynamic-workflow orchestration — and the break in the rule is what says so
before the `xhigh + workflows` caption underneath gets the chance. It is offered
exactly when `xhigh` is, that being what it runs on.

It is also the one thing on the scale that Settings does not offer. A default is
inherited by every new conversation, and walking into a fleet of agents for the
next small question is not something to inherit — so `ultracode` is chosen per
conversation, and the settings' own field stays five levels wide.

**An octopus stands above the scale, one per choice** — an egg with a single
tentacle out of it at one end, a whole fleet of them at the other. It is the
reason to open the panel rather than read the chip, and the one thing here
recognised rather than read. The pictures live in
`src/renderer/src/assets/effort/`, 512px against at most 240 on screen and
scaled smoothly, for the reason the mascot's paragraph under **Empty panes**
sets out. The box never scales one up: past its own grid a pixel drawing goes
soft in exactly the way the drawing was made to avoid — so a bigger octopus
means regenerating the files, not raising the number.

What sets the panel's **width**, though, is neither the picture nor the taste of
whoever last looked at it: it is the longest level name. At 480 the scale read
`Very hi…` and `Maxim…`, and a label cut short is a level the reader has to
already know in order to recognise.

**The model chip opens a panel, not a list**, because the question has two
halves: which model plans and researches, and which one writes the code. They
sit in two columns side by side — the answer is not "which model" asked twice
but which of the two does which job, and a panel you have to scroll between
halves of is that question asked twice again.

No second control was added for it. A chip for the plan model beside the one for
the coding model would be two settings in a row that already holds three, with
nothing on screen saying they are two halves of one question.

Its rows carry **names only**, where the old menu carried the agent's
descriptions: "Opus 5 with 1M context · Best for everyday, complex tasks" does
not fit a column two hundred pixels wide, and the chip is what a reader consults
for the wording.

**A pick leaves the panel open**, which is the one place in the interface a menu
does not close on being used — and it is a `dialog` rather than a `menu` for the
same reason. Two columns is two answers, and closing on the first would make
setting both a matter of opening the thing twice.

**The plan column's first row is what makes the split optional.** `Same as
writing code` is ticked until someone says otherwise, and while it is, the
conversation runs one model and behaves exactly as it did before it could hold
two. The row names the model it resolves to underneath, because that is the fact
a reader opening the panel came for.

**The chip names the model in force**, which is the plan model while planning a
conversation whose two differ, and the coding model everywhere else. The effort
control follows the same reading — so a plan model that takes no effort greys it
out for as long as planning lasts, and gives it back afterwards.

**The three settings in the row do not all behave the same way, on purpose.**
The **model** is read back: the context reading names what the session is
running, so `/model opus` moves the chip and the record stays what was chosen
here. The **mode** and the **effort** are re-asserted on every message instead,
because neither can be read — no SDK message reports the effort, and
`applyFlagSettings` answers nothing. So `/effort high` and `/permissions` last
one turn each: the control names the level the next message will run at, which
is the reading that matters at the moment anyone consults it.

**Every row of the panel names a model.** The catalogue's first entry does not:
the CLI calls it `Default (recommended)`, which tells a reader nothing about
what they are about to talk to. It does say what it _resolves_ to, and the
catalogue carries a second row for that same full name — so the default row
wears that row's name and is marked `by default` underneath, and the duplicate
is folded away rather than drawn twice under one heading. `modelRows` builds
this, over `defaultAgentModel` in core, and is called **once per column**: each
pins its own value, and shared between them one column would drop the row the
other is running on. A chat that chose nothing ticks that row, which is why
there is no longer an `Agent decides` entry beside it: the two said the same
thing, and only one of them could name a model.

Before any session has reported a catalogue there is no name to wear, and the
row reads `Default model` — words rather than the raw `default` the picker would
otherwise print.

**The chip names what is running when that differs from what the panel ticks.**
A `/model` command is what causes it: the CLI scopes it to the session ("for this
session only"), so it moves what is running without moving what this chat chose
— and the record staying put is the truth rather than a compromise. The name
reaches the footer with the context reading, which is already refreshed on every
`result`, so the chip moves as soon as the command's turn ends.

**The footer's permission control is two things, not one**, and they are two
stored fields. `plan` is not a third degree of permission but a state the
conversation is in: the agent runs no tools at all in it, so `Auto mode` has
nothing to accept. Held as one field they could not both be true, which is why
approving a plan had no mode to return to — and why the toggle stayed lit over
an agent that had started editing.

That leaves the mode itself with two values, so it **switches in place** rather
than opening a menu. A list of two was a click to open it, a list in which one
of the two visible rows was already in force, and a click to choose the other —
three steps to say what one click says. The pickers beside it keep their menus,
because their lists are open-ended. The chip is tinted while `Auto mode` is on,
the same treatment the plan toggle gets: of the settings in that row, the one
where the agent writes unasked is the one worth noticing without looking for it.

`Auto mode` keeps its English name in every locale — it is what the agent's own
interfaces call it, and a translated name for a borrowed one reads as a second
setting rather than the same one.

**The right pane** holds Changes, Terminal, Scripts and Pull request. The
Scripts tab runs `setup.sh` on its build half and `run.sh` on its server half,
with the workspace's port in `$OCTOPUS_PORT`. Both run on a button: starting a
server because a tab was clicked is a surprise.

**One `Run` sits above both halves**, and is the whole tab in one control: it
builds, and starts the server when the build succeeds. The first thing anybody
does with a new workspace is these two steps in this order, and the second only
makes sense after the first — two buttons made the reader supply the ordering
every time.

A failed build stops it there and says so. A server started on top of a broken
build fails in a way that points at the server rather than at the build that
actually broke. A project with no build script skips straight to serving: §4
says no step is mandatory, and waiting on a half that is showing an invitation
to write one would simply hang. With no server script there is nothing to run,
so `Run` is disabled — the server half already carries that invitation.

The sequence is **keyed by workspace**, exactly as the runs are: leaving one
mid-build to look at another must not report the second as building.

**Running is decided on that header, never in the halves.** There were four
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
| building        | `Building…`, disabled              |
| serving         | open in browser, `Restart`, `Stop` |

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

**A build still cannot be stopped**, and that is the asymmetry rather than an
omission. A server is started and stopped for as long as the work lasts; a build
is run, read, and run again when something changed — and `Run` already ends the
build it replaces, because remounting the terminal is what kills the old
process. So stopping a build is running it again, and `Stop` stays with the
thing it was asked for.

The fold control on the build's heading is named for what it does rather than
for the word on it: `Build` is also the heading it carries, and two controls
with one name are ambiguous to anything reading the pane aloud.

**An `Env` menu sits on that heading permanently**, not only while the build script
is missing. The moment anyone notices an env is missing is a run that could not
find it, and by then the empty state that might have carried the button is gone.
It is a **sibling** of the fold control rather than a child of it, so reaching
for the env cannot put the build away. It is a menu rather than a button because
the answers are genuinely different in kind: the variables are typed, the files
are copied, showing this workspace's env is not an edit at all, and the set of
variables this workspace runs with is a choice among several. A single button
could only ever reach one of them, and for a project cloned from GitHub that was
reliably the wrong one — nothing gitignored was ever on GitHub to copy.

**Which set it runs with is on that menu too**, listing the project's named sets
with the workspace's own marked. The project's choice is the default and
`Follow the project` is a real entry rather than the absence of a choice, so a
workspace can be put back on the project's set after being pinned. Choosing one
while the server is up says so: the header turns the label to warning and the
pane says the server is still holding the old values, because a header that
changed silently would be the failure the whole feature exists to prevent,
pointing the other way.

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

### What a repository is allowed to run

**The Scripts tab shows the panel when there is something to read.** A checkout
supplying its own scripts has them listed there — grouped by the file they came
from, since all three of Conductor's live in one `settings.toml` and naming it
three times reads as three files — with every byte of what would run, and `Run`
disabled until it is allowed. This is where it belongs because it is the answer
to "why is Run doing nothing", and that question is asked in front of `Run`.

After it is allowed the panel goes quiet, and the place to look is **Project
settings → Repository**: the same section as Import and Export, listing each
script the checkout supplies, the file it came from, and whether it may run,
with the per-project trust switch under it. One question — how much of this
checkout the app believes — in one place, rather than a banner that appears once
and is gone.

**The Scripts section of that dialog names the source above each editor**, and
makes it read-only where the repository supplies the script. It used to be three
plain editors: with a `.conductor` present, editing Build there saved happily
and changed nothing that runs. A box that takes an edit it will not honour is
worse than no box.

**It asks about the workspace the dialog was opened from**, and about the
checkout only when there is none. A run happens in a worktree, and a branch may
carry a script the checkout has not got — asked of the checkout alone the
section described one set of scripts while the workspace beside it ran another,
and marked the editors read-only against scripts that were never going to run.
The Repository section resolves the same way, so one dialog gives one answer.

**A repository whose settings will not parse says so.** Half a file left by an
agent, or conflict markers left by a merge, used to disable `Run` and say
nothing at all — in an app that ships a _resolve conflicts_ action.

The project dialog's **Instructions** section lists what the agent picks up on
its own, in three states rather than two: absent, on disk but not read, or read.
The distinction is the whole point — "on disk" is a stat and "read" is a claim
about what the session was started with, and printing the first under the
second's name made the panel wrong in every `settingSources` mode at once. Its
`notes` are keyed by position: one line can carry the same complaint twice, and
identical strings collide as keys.

**Skills sit in both dialogs, and the section is one component.** The two
differ only in reach — every project, or this one — which is what the store
prop says, so writing them separately would have been two copies of a list that
drift apart the first time either is touched. The switch on each row is about
what a **new** conversation starts with; the panel in the composer is about the
one in hand, and the two are deliberately different questions in different
places. The project section additionally lists what the checkout carries,
read-only with a single Copy action: those files belong to the repository, and
editing them from here would be the app writing inside somebody's checkout.

`FileEditor` can carry `notes` — a function run against the text on every
keystroke, whose answers appear under the box. The env block uses it; told on
blur instead, a warning arrives after the attention that could act on it.

**Files and Env are two sections, because they are two mechanisms.** `Files`
names whole files to copy; `Env` holds `KEY=value` lines typed by hand. The
split is not tidiness — one names files, the other names values, and one editor
holding both would have to explain why half of it does nothing for half the
projects.

The reason used to be sharper and is worth correcting rather than leaving: it
said the copy answers nothing for a project cloned from GitHub, since the
gitignored files were never on GitHub to clone. That was true until a line could
say **where** its file comes from. A checkout that has not got the file is now
answerable too, as long as another copy of the repository is on the disk — which
it usually is, and was in the case that prompted this. What stays true is that a
fresh machine has neither, and there the variables are still the only answer.

**The change count follows the work.** It used to be read when the list was —
on create, rename, remove and first load — and never again, so the agent could
rewrite twenty files while the row went on saying what it said an hour ago,
beside a diff pane that re-reads itself on the same event. The list now listens
for the same turn endings and settles for the same 300ms, and re-reads only the
project the workspace belongs to: a turn ending is a poor reason to run
`git status` over every workspace of every project.

**The right pane carries four tabs.** Changes and Terminal, then Scripts and
Pull request. Build and server were two tabs and are now two halves of one: they
are the same question — what this workspace runs — and splitting it cost a fifth
of a row whose width has to be **measured** because it barely fits. Stacked, a
server can be seen running while a build is read, which two tabs could not show
at once.

Each half is a named region rather than an anonymous box. Both are on screen
together, so "the Run button" is ambiguous to anything reading the pane aloud —
and each half keeps its own `min-h-0`, because a terminal measures itself against
the box it is in and one never told it may be shorter grows instead of scrolling.

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

**The pull request tab is the one place that reaches GitHub for something other
than cloning.** It names the branch, and then either reports the request there
is — number, title, a link out — or offers the form that opens one. Two things
are said **before** the button rather than after it fails: that opening will push
a branch that is not pushed, and that uncommitted work stays behind. Pushing
touches somebody else's machine, and a button that does that silently is one
people learn to distrust.

Two buttons sit above all of that. **Instructions for a new PR** opens the
project's own instruction where it lives, in project settings — one editor for
one file, reached from the place it matters, which is the arrangement "Write the
script" already uses. A second editor here would be a second place for the two
to disagree.

**Ask the agent to describe it** sends that instruction — the project's, or the
global one in Settings where a project has written none — to the workspace's
conversation, as an ordinary message. Not a call behind the reader's back: §4
leaves no room for the app prompting the agent invisibly, and the answer has to
appear in the conversation anyway. With no conversation open the button says so
rather than starting one, since a conversation created by a button pressed for
something else is a surprise.

It asks `gh` nothing while another tab is showing. The diff follows the same
rule, and it matters more here: this leaves the machine, so a hidden tab would be
a network call for every workspace opened. `⌘⇧P` selects it — the shortcut §10.8
had listed since before there was a tab to name — and so does **Create PR** in
the window header, through the same callback, because two copies of "open that
tab" drift the first time one of them is touched.

**The pane is one component per question**, under `components/pr/`, beside the
diff's own folder: the summary, the checks, the review, the actions and the form
for a request that does not exist yet.

Two reads feed it, and they are apart on purpose. `workspaces:pullRequest` says
whether the branch has one; `workspaces:pullRequestDetail` says what has become
of it. When the first fails the pane blanks, because nothing on it is true any
more; when the second fails the number, the title and the link stay and the
error sits under them. One `Result` could not say both.

**The detail re-reads itself every 15 s** while a check is running _or_ while
GitHub has not decided whether the branch is mergeable — a self-rescheduling
`setTimeout` rather than an interval, so a slow reply never has a second read
stacked on it. The second half of that condition is load-bearing: mergeability
is computed asynchronously, so the first read after every push says it is
unknown, and a request whose repository runs no CI has no pending check to wait
on at all.

**A check's state is a word as well as a mark**, and so is the review's verdict.
A colour reaches nobody using a screen reader, and it is also the only handle a
test has on which state a row is in — the lesson the tab row above already
carries.

**Add to chat** puts a remark from the review into the composer rather than
sending it. The reader has a question about it, and the question is the point.
It rides the same strip as a note written on the diff, though the two are
separate stores: the diff pane narrows a `DiffComment` on every row it draws,
and a union with a member it can never hold would put an unreachable guard in
each of those places. `attachments.ts` is where they become one list, in
`ChatSession`, which is already the layer that turns a controller into a prop.

**The prepared messages** — fix the checks, answer the review, review it, review
it with several subagents, resolve the conflicts — each send the project's
instruction plus a line naming the request. Drawn twice rather than once around a
guard: without a conversation the press could not do anything, and a branch
nothing can reach is a claim nothing tests.

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

**A branch says where its pull request stands**, in a glyph beside the workspace
name: green once the checks pass, a spinning green ring while they run, orange
when one has failed, accent while the repository has run nothing, red once it is
merged, faint once it is closed unmerged. Nothing at all where there is no
request, which is most branches most of the time — a mark for that would put an
icon on every row and say nothing by being there. Every state goes out as a word
in the label too.

It costs one `gh` call per project rather than one per workspace, on a minute's
timer while the project is open, and a failure is silent: there is no room on a
row to explain one, the tab says it properly when opened, and a repository with
no GitHub remote is an ordinary thing rather than a fault.

**The workspace list says what each one is doing.** One mark carries it: the
agent's state takes the dot while there is something to report — the accent
while it works, `warning` while it is stopped on a question, `danger` after a
failed turn, `success` once a session has run and stopped — and falls back to
the filled dot for uncommitted work when there is not. Two marks side by side would make the list busier than the thing it
describes, and `warning` is the one worth crossing the window for, because that
turn has stopped and is waiting on you.

### What is left of the account, at the foot of the list

The account's plan windows sit under the workspace list rather than above the
composer, where they used to be. They say nothing about the conversation they
were sitting in: the same set applies to every workspace, and the decision they
inform is whether to start something at all, which is made looking at the list
rather than at a chat.

**They are there before the first message.** The service keeps the last reading
in `state.json`, beside the model catalogue and for the reason already written
on that field: so something is usable before the first message. It is a second
of staleness now rather than a launch of it, since the first read lands as soon
as the window takes focus — but a block drawn empty for that second would
flicker on every launch.

**It is polled, and it will start a session to answer.** This is a reversal, and
the thing that reversed it is a measurement. The rule was written on the
assumption that answering costs an agent; a cold read — spawn the CLI, ask,
answer — is **720–850ms**, one against a session already running is about
**260ms**, and neither costs a token, because it is a control request rather
than a turn. Three things keep the figures current:

- **the service announces a reading that moved**, so a finished turn reaches the
  block on that turn;
- **coming back to the window asks**, because whatever happened in the
  background announced itself to nobody here, and the figure informs a decision
  taken the moment somebody looks;
- **a slow timer while the window is visible** — three minutes — for the window
  left open and watched. Stopped while it is hidden: nothing behind a hidden
  window is worth spawning a process for.

The control stays, because a press is still the right way to ask _now_. What it
no longer is, is the only way.

**Reads are coalesced, and a session started to answer is closed again.** All
four askers can land at once, and each starting its own read would spawn its own
CLI to ask one question, so the one in flight is shared. And a probe is shut in
a `finally`: `startFor` registers into the session map, so every press used to
leave an agent running for the rest of the session — which mattered little at
one press and would be one more agent every three minutes now.

**Having nothing to draw is four sentences, not one.** Never read; this account
has no plan windows at all; there was nowhere to ask through; the read failed.
A single nullable value stood for all four and got two of them wrong — a failed
read handed back the previous figures and reported success, so the press redrew
a stale number as though it were fresh, and an empty cache after a failed read
said "open a workspace first", which describes only one of the ways it happens.

**A typed `/usage` fills it too.** The command and the block draw the same
windows out of the same answer — one narrowing in `core/usage.ts`, not two
readers of one request — so the reading is kept rather than drawn once and let
go, which used to leave the block stale beside a card that had just shown the
same figures fresh.

**Every window the account reports is drawn**, not two of them. They arrive in
one answer and the block used to keep four numbers out of it, so an account with
a weekly window per model had it named by the `/usage` card and missing here.
`toLimits` drops a window with no share, so most accounts still see the two rows
this always had.

**The windows are named** (`5h`, `1w`, `1w Opus`, `1w Fable`) although the old
header chip never named its one: two figures under each other are unreadable
without labels, while one figure beside a countdown was not. The names are
short here and long on the `/usage` card — `1w` against `Current week (all
models)` — which is two labels for one window and deliberate: the card has a
column to write in and this has two hundred pixels for the whole row. What must
not differ is _which_ windows exist, and `usageWindows.ts` holds both tables so
a window added to the allowlist fails to compile until it is named at both
widths.

**Each window says when it comes back, not how long it has left.** `32% · 14:30`
reads at a glance in a way a countdown cannot: the reading is redrawn when the
service announces one, when the window is looked at, and every three minutes
while it is — so `2h 30m` written there would be wrong between any two of those,
while an hour of the day stays true however long it is looked at.

The clock is 24-hour and the date is `DD.MM` in every language, following
neither the app's language nor the system's locale. `6:00 PM` spends three
characters saying what `18:00` says, and both locales the app has write the day
first — a locale that does not is the reason to revisit it. The date appears
only when the clock alone would not say which day it is the hour of, and the
boundary is the **calendar day** rather than a rolling twenty-four hours,
because "which day" is what a reader reasons about: a bare `01:00` seen at 22:00
reads as a time that has already gone. So the weekly window is dated almost
always and the five-hour one only across midnight.

**A reading whose window has already reset is faded rather than shown as
fact.** `formatResetAt` answers nothing for a moment that has gone, which is the
whole of how staleness is told here — there is no second clock. A stale 95%
drawn in red would be the sidebar raising an alarm about something that is over.

**The bar is green while there is room**, `warning` from 60% and `danger` from
80%. It is the one place a calm reading is coloured at all: a bar is a block of
colour by design and has room to say "fine", where a number in green would be a
number wearing a colour — so the figure beside it stays `ink-faint`. The
thresholds come from `usageLevel`, the single place they are read, so this and
the `/usage` card cannot turn colour at different points.

**A run belongs to its workspace**, the way a terminal does, so there is a
runner per workspace and several can serve at once — which is what the unique
port is for. It is the open project's workspaces that get one: the script paths
are that project's, and a runner left standing from another would offer to run
this project's `setup.sh` somewhere that never asked for it. Leaving a project
therefore ends its runs, which is the remaining edge and is written down.

**Every tab is kept mounted** behind whichever one is showing, and hidden with a
class. A terminal unmounted is a process killed — and so is a script, because
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
**measured, not chosen**: it is whatever its four tabs need. The labels change
width with the language, a number picked against English left the Ukrainian ones
overflowing, and since the pane does not shrink, anything sticking out of it
pushed the window wider and put a horizontal scrollbar under the application.

**The tabs cannot wrap and cannot shrink**, and that is what makes the
measurement mean anything. A button free to squash reports the width it was
squashed to, so the floor came out under what the labels need and the pane
squashed them again — a measurement taken from its own consequence. `Pull
request` is where it showed: the label broke across two lines inside a row 32px
tall. `shrink-0` and `whitespace-nowrap` on each tab are the whole fix.

The right pane's ceiling
is whatever the window has left after the left column and a usable centre, so it
grows on a large display without a number to maintain. That column is passed
down from `App`: it is the project strip plus a list that is resizable and folds
away, and against the constant it used to be measured by, a list dragged wide
left the centre nothing at all.

**Dragging the window's own edge drags the right pane's edge with it.** The
centre used to take every pixel the window gained or lost, being the only pane
with no width of its own — and the conversation stops widening at 72rem, so what
it took was margin, while the diff and the terminal stayed as narrow as they
started. Now the pane absorbs the change and the centre keeps the width it had;
narrowing takes that width back out of the pane first, and only once the pane is
down to what its tabs need does the centre begin to lose room. The list on the
left never yields a pixel: exactly one pane may absorb the change, or "the
centre keeps the width it had" stops being true and needs a rule for splitting.

What the window adds is not saved. The config holds the width that was dragged,
the pane remembers the window it was dragged at, and what it shows is the
difference — which is what puts the pane back where it was when the window goes
back where it was, without anything having to remember the journey. The window's
own size is not stored either (`src/main/index.ts`), so every launch starts at a
width where the saved number applies as it stands.

**Only the ⌥ shortcuts ask where the focus is.** ⌘ and ⌃ are not typing
gestures, so a shortcut on them is unambiguous wherever it is pressed — but on
macOS ⌥ is how a great many characters are typed, and ⌥1 in the composer was
switching conversation while swallowing the `¡` somebody meant to write. The
terminal is one of the surfaces that counts: xterm.js takes its input through a
hidden `textarea`, so a key pressed at a shell belongs to the shell.

## The diff

One scrolling column, not a list beside a viewer. The pane is 360px by default,
and a second column inside it leaves neither half readable — so the file headers
are **sticky** and the column doubles as the list, which is what the navigation
was for. Sticky needs the scroller to be the only thing hiding its overflow
between it and the header; an intermediate `overflow` anywhere in between and
the headers stop sticking with nothing to say they have.

**What is measured against what.** The left-hand side is the merge base of the
project's base branch and the workspace's HEAD, and the right-hand side is the
working tree — so committed, staged and unstaged work all show, while whatever
landed on the base branch after the fork does not. A change staged and then
reverted in the working tree is invisible, which is the right answer for a pane
that reports what the workspace now holds.

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

**Syntax colours arrive after the diff does.** A side of a file is tokenised
whole rather than line by line, or a block comment is coloured wrongly from its
second line on. The hunks are joined end to end, so a construct opened in the gap
between two of them is still invisible. Nothing waits for a grammar: an
unhighlighted line is drawn in `--ink`, and a highlighter that never starts costs
the reader only the colours.

**Files over 500 changed lines start collapsed**, and what the core left undrawn
is said in the header rather than quietly appearing unchanged.

**A character that does not draw as itself is named where it stands.** Text goes
on screen through the browser's bidirectional algorithm, so a right-to-left
override reorders what a reviewer reads without changing a byte of what the
compiler reads — the Trojan Source trick — and a zero-width character draws as
nothing at all. Nothing is executed: React escapes the markup, and the danger is
narrower and worse suited to being ignored, because a pane whose only job is
checking work before it merges would be showing a line that is not the line.

Such a character is replaced by a chip naming its code point, `U+202E`, which
stops the reordering as well as reporting it — a marker elsewhere on the row
would name the problem and leave it standing. The file header carries a warning
too, since a large file starts collapsed and an unread line is the one most
likely to be approved. The path gets the same treatment, being drawn from the
same bytes: a file can be named to read as an image while ending in `.js`.

U+200C and U+200D are deliberately left out. Persian and Indic text need them
and every multi-part emoji carries one, so warning about those is warning about
nothing by the second file. `shown` in `src/renderer/src/components/diff/shown.tsx`
is the one place this is decided, and the chat's change block calls it too — the
surface where a two-line edit is usually read instead of here.

**A note against the code rides out with the next message.** It becomes text —
the path, the lines, the code as it read when the note was written, then the
remark — above whatever was typed, because nothing implicit reaches the agent
(§4). The two sides of a diff are different lines even at the same number.

**A note covers a passage, not only a line.** The trigger in the gutter takes
one line, and selecting code with the mouse takes as many as were dragged over:
a button appears at the selection and opens the same editor. One line is the
right unit for "this line is wrong" and the wrong one for a condition spanning
three, the two halves of a rename, or a block that should not be there — each of
which used to mean several notes and the hope that the agent joined them up.

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

## Colour

Tokens only, declared twice — `:root` and `.dark` — in
[`styles.css`](../src/renderer/src/styles.css). **Never a raw hex in a
component**, or the dark theme breaks.

Scrollbars are themed from `:root` with `scrollbar-color`, which inherits and so
reaches every scrolling box including xterm's viewport. Left to the platform they
are painted for a light page, and a pale bar down the side of a dark chat was the
one piece of chrome ignoring the palette.

Surfaces: `canvas` → `surface` → `muted`, separated by `line` and `line-strong`.
Text: `ink` → `ink-soft` → `ink-faint`. Status colours apply to text and icons;
only the paired `*-bg` is used as a background.

Two places put one on a surface anyway, and the test for both is the same: the
colour is the thing rather than a mark on it. `Button`'s `destructive` variant
fills with `danger`, because a button that deletes something is the warning. The
filled part of a `UsageBar` drawn as a `limit` is the other — a bar in the ink
colour beside a number in `danger` would be one gauge contradicting itself, and
both readings come from `usageLevel` in `chat/format.ts`, the only place the
thresholds live. Anywhere the colour would merely _label_ a row, it goes on the
text or the icon and the `*-bg` goes behind it; the status dot beside a
conversation is the icon case, not a third exception.

A `share` bar — which skill used the most of a week — stays neutral however high
it goes. It is a proportion of something that is not running out, and drawing it
in red would be the interface raising an alarm about a fact.

### Project colours

Fifteen, `--project-<name>`, one pair per theme. The colour is **stored on the
project**, not derived from its name — a hash would repaint a project the moment
it was renamed, and constancy is what makes it recognisable.

Applied by setting `--project-color` inline on a container. That inline style is
the sanctioned exception: the value is dynamic, but still resolves to a token.

The colour is one half of a project's mark; the other is what sits inside the
tab. By default that is two initials, which collide readily — two repositories
starting the same way give the same pair — so a project can be given an icon
instead, chosen in its settings dialog. The ids live in
[`icons.ts`](../src/core/icons.ts) and the renderer maps each to a drawing in
`ProjectGlyph`, typed as a full `Record` so an id with nothing to draw fails the
type check rather than leaving a hole in the strip.

Two rules that are easy to get wrong:

- **Text on a filled colour uses `--project-ink`**, not `#fff`. The dark theme
  uses brighter values on purpose, where white is barely legible.
- **Measure contrast, do not judge it.** Five colours looked fine and sat
  between 3.3:1 and 4.1:1 against white — under the 4.5:1 body text needs.

## Selection is a relationship, not a highlight

The instinct is to make the selected thing the brightest. Browser tabs do the
opposite, and they are right: the active tab is the panel reaching back.

So the active project tab takes exactly the colour the sidebar's gradient starts
with, runs to the strip's edge and squares off, with no line between them. Two
consequences generalise:

- **surfaces meant to join must start at the same coordinate** — four pixels of
  padding broke the effect outright;
- **delete the redundant signal** — once the tab visibly joined the panel, the
  marker beside it was a second answer to a question already answered.

The right pane's tabs are built the same way and for the same reason. They sit
on the line that closes their row, and the chosen one breaks through it —
`items-end` puts them on the line, `-mb-px` and a transparent border let the
tab's own fill paint over it — so the tab reads as the view below reaching up.
The fill is the open project's colour and there is no outline: a drawn edge made
the tab look like a box resting on the row rather than part of it.

Its earlier shape is the lesson worth keeping. A muted fill measured 1.09:1
against the pane behind it — two greys a fraction apart, invisible — so where
selection cannot be shown by relationship, show it by **hue, not brightness**.

`.tab-selected` reads `var(--project-color, var(--accent))`, and the pane sets
the variable only when a project is open, so with none every fallback resolves to
the accent. A fallback is what makes the variable optional; setting it to an
empty value instead would leave `color-mix` invalid and the tab with no fill at
all.

### Selection can also be a surface

The workspace list is the case where neither of those works. Its ground is
already a wash of the project's colour, so a second colour on top — the row used
a fill of the blue accent — read as a foreign object rather than as "this one":
two unrelated colours in the same 200 pixels.

So `.row-selected` lifts the chosen row out of the wash onto the plain canvas,
and the only colour left is the 2px mark down its left edge, in the project's
hue. `.row:hover` has to be restated for the selected row, or the cursor
repaints what selection has already said.

None of that reaches a screen reader, so whatever is chosen — a workspace row, a
project tab, a rail item — also carries `aria-current`. That attribute is the
only handle a test has on selection as well: the rest of it is a class.

### The one place colours are read as values

xterm paints to a canvas, which no stylesheet reaches, so `Terminal` reads the
tokens through `getComputedStyle` instead. It re-reads them whenever the class on
the root element changes.

Reading once at mount was wrong twice over: a terminal opened in a light window
kept its light colours through a switch to dark, and one mounted before the
stored preference had come back over IPC read the light defaults and stayed
white inside a dark application. Watching the class catches both without the
theme having to be threaded down four components to reach a leaf.

## Empty panes

`Placeholder` is the one component for "nothing here yet": the mascot, a title,
a line saying what to do, and optionally the buttons that do it. One component
rather than a copy per pane — the centre and the chat each had their own and
they had already drifted a few pixels apart, on the screen a first-time user
reads most carefully.

Those buttons go in `actions`, not in the body. The body renders inside a `<p>`,
so a button passed as `children` becomes a block element inside a paragraph, and
the browser silently rearranges it into markup nobody wrote. The slot is a
sibling of that paragraph for exactly this reason.

**The centre has three empty states, not one**, and they are told apart by what
is missing: no projects at all, a project not chosen, and a project chosen with
no workspace showing. The last splits again — a project whose workspaces exist
but none is selected, and one that has none yet. That second case used to wear
the first one's face, telling the reader to select from a list with nothing in
it, and offering no way out: the button that makes a workspace lives in the
sidebar's project header, which is not where someone who has just added a
repository is looking.

Deciding this in `App` rather than in the chat is the point. The way out of "no
workspace" is to create one, and the chat has no business knowing how — it takes
a workspace that exists and talks to it.

Prefer offering the action to describing it. The centre pane spent a while
telling a first-time user to add a repository in the left panel while having
room for the button that adds one — an empty pane is usually a pane with space
for the way out of it.

**The repository picker groups by owner**, the account's own repositories first
and then each organisation. Before organisations reached this dialog the list
was one flat run of names; with a work organisation in it the list is several
times longer, and its own name is the only thing anybody scans for. The order
comes from core, and the picker groups in the order it was handed — one question
with one answer rather than two that can drift.

It offers only repositories the account can **push to**. octopus works by
pushing a branch and opening a pull request from it, so a repository that can
only be read looks like a working choice right up until the first push fails.

The same goes for a message that names somewhere else. "Check the account in
Settings" stood in the repository picker for a while with no way to reach
Settings, which leaves the reader to close the dialog and go hunting. If a
string names a place, something beside it should go there — and only when going
there would help: the picker offers it for an unreachable account and not for a
failed clone, because signing in again fixes one and not the other.

The mascot comes from `Mascot`, which also signs off the About section in
settings. A component rather than a repeated `<img>` so the decision it carries
is made once: it is `alt=""` and `aria-hidden`, because wherever it appears the
words beside it already say what the screen is about, and announcing "blue
octopus" first would add a word and no information.

The source is 256px against 96 on screen, scaled smoothly rather than with
`image-rendering: pixelated`. Nearest-neighbour at that ratio drops pixels
unevenly and the blocks come out different sizes, which reads as a broken image
rather than as pixel art.

## Ready-made classes

`.panel` · `.row` / `.row-selected` · `.input` · `.section-label` ·
`.focus-ring` · `.titlebar-drag` · `.project-tinted` · `.bubble-sent` ·
`.tab-selected`

The last three are where a project's colour turns into a surface, and they are
classes rather than inline styles on purpose: the component says _which_ project,
the stylesheet says _how_ the colour is used, so the three places it appears
cannot drift apart.

The second copy of a run of utility classes belongs here. Six copies of the
field styling had already drifted by a few pixels of height.

## Shared components

| Component                                                       | Worth knowing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Modal`                                                         | body has **no padding** — a list spans the full width, a form brings its own. A backdrop click does not close it. `lg` is a fixed height so sectioned dialogs do not resize between sections; `md` grows to the window less a margin, because what it carries is read rather than filled in — a plan, a list of repositories — and height is how much of it you see at once                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `DropdownMenu`                                                  | positioned against the **window**, not its trigger — an absolute panel is clipped by any scrolling ancestor, and the tab strip is one. So the coordinates are a snapshot, and a scroll closes it only when it happened in something the trigger sits inside; anything else cannot move it. Widens itself when its items carry a second line, and wraps that line to two rather than truncating: the model descriptions come from the agent, and one written for a width chosen for one-word commands says nothing when cut short. **Its panel is drawn into the body**, because `z-50` only ever means "above its own siblings" — the diff's file headers are `sticky` with a `z-index`, which starts a stacking context, and a menu opened from one was painted behind the header of the file below it |
| `Combobox`                                                      | a select with search; a native one stops being usable around thirty entries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `SectionRail`                                                   | the rail shared by both settings dialogs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ComposerChip`                                                  | the button each composer setting opens from. Ghost, not `Button` — a bordered control on that surface reads as a chip, and a row of them makes a toolbar competing with the field above. Its own file because the two things opening from that row are not the same kind of thing, and written twice the classes would drift the first time either was touched                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `EffortPicker`                                                  | the effort chip and the scale behind it, `Faster` to `Smarter`, with `ultracode` past a gap at the end and an octopus above it. A `slider` rather than a row of buttons: the ordering between the levels is the fact it exists to show, and buttons inside would be a tab stop each on a control whose whole point is one handle                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `ModelPicker`                                                   | the model chip and the two-column panel behind it: which model plans, which one writes the code. A `dialog` that **does not close on a pick** — two columns is two answers, and closing on the first would mean opening it twice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Switch`                                                        | on or off, as a control that says which without a word. `role="switch"` on a `button` rather than an `input`: what it toggles applies at once, and the row it sits in is not a form. Painted exactly like `.choice` so the two read as one family in a dialog that shows both — the checkbox stays for "include this in what I am about to do", this is for a state something is already in                                                                                                                                                                                                                                                                                                                                                                                                             |
| `SkillsPanel`                                                   | which skills this conversation may reach for, in three groups — ours everywhere, ours for this project, and what the checkout carries. A group with nothing in it is not drawn, and the third is absent entirely when the Agent setting would not load it. The foot says what switching one off does, because a switch that looks like a lock is worse than no switch: the skill leaves the agent's listing and its files stay on disk                                                                                                                                                                                                                                                                                                                                                                  |
| `SkillsSection`                                                 | the same list in both settings dialogs, given the store as a prop — they differ only in reach, and two copies would drift into looking like different features. Its switch is about **new** conversations; the panel above is about the one in hand. The project one also lists the checkout's own, read-only: editing those from a settings dialog would be octopus writing inside somebody's checkout                                                                                                                                                                                                                                                                                                                                                                                                 |
| `SkillEditor`                                                   | a form for the two fields anybody writing a skill is actually choosing, and the document itself one click away. The raw mode is not an afterthought — `allowed-tools` and `when_to_use` live in that frontmatter, and the form's save keeps every key it does not know about. The name is disabled after creation: it is the folder and the key every stored answer uses                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `useAnchoredPanel`                                              | where both composer panels are drawn: `fixed` against the window the way `DropdownMenu` does it and for the same reason, flipped above the chip when it would run off the bottom, clamped when it would run off the right, closed on a scroll of something the chip sits inside. The size is given per opening, since a panel's height can depend on how many rows it is about to hold                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `selectionAnchor`                                               | how a browser selection becomes a review note: the rows carry a `data-line` address and this reduces the ones a range touched to a file, a side and two line numbers. Pure and string-only, so the awkward cases — two files, both sides, a path with a colon in it — are tested without a layout engine                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `Markdown`, `CodeBlock`                                         | how the agent's own output is drawn. A fenced block gets a frame and a copy button in its own row, never floating over code that scrolls sideways. The block/inline distinction is taken from `pre`, not from the language class: a fence with no language hands the `code` override exactly what inline code does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Settings`                                                      | `initialSection` opens it where the caller needs it. Read once, on mount — correct only because `App` renders the dialog conditionally, so a close unmounts it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `ProjectGlyph`                                                  | a project's icon, `aria-hidden`: wherever it appears the element around it is already named                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Field`, `FileEditor`, `NameEditor`, `ResizeHandle`, `Terminal` |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

`Button` has four variants: `accent`, `quiet`, `danger` (subdued destructive),
`destructive` (filled, for the action a confirmation is asking about).

`useConfirm` can carry one extra choice as a checkbox, and it may start ticked —
removing a workspace offers to delete its branch, already marked, because a
workspace is one task and the branch behind a finished one is finished too. That
is the only shape a destructive default may take: on screen, in the dialog the
user is already reading, and undone with one click before they confirm.

## State

Four hooks own everything that talks to IPC: `useProjects`, `useWorkspaces`,
`useChat` and `useRateLimit`. A component that lays out a window should not also
know what an IPC failure looks like.

`useRateLimit` is separate from `useChat` because the figure belongs to the
account rather than to a conversation: every workspace reports the same one, and
switching between them must not blank it out.

`useChat` reads the history from disk **once** and then only appends what
arrives as events. Re-reading the file to merge would bring back, as a
duplicate, every entry the UI had already drawn.

The split is not all-or-nothing: `useProjects.remove` asks and deletes, while
`App` clears the selection afterwards — what points at a project is the window's
business.

**An operation that waits is guarded in the hook, not on the button.** Creating
a workspace fetches its base branch first, so it is no longer over before a
second press is possible — and the three places that offer it (the sidebar's
`+`, the centre's empty state, ⌘⇧N) would otherwise each need their own guard,
with the shortcut having nothing to hang one on. `useWorkspaces.create` holds
the latch in a ref rather than in state, because state is what a second press in
the same tick would not have seen yet, and exposes `creating` for the buttons to
show. Two presses do worse than make two workspaces: both read the same list of
taken names, so the second is refused over a path the first has claimed.

A button that stops responding also has to say why. The `+` swaps its plus for a
turning mark while it waits — a still, dimmed icon reads as the app having hung
rather than as it working.

## Two lint rules that will stop you

- **No `setState` in an effect.** State derived from a prop is adjusted during
  render (`if (activeId !== lastActiveId) { … }`); state that follows an event
  is set in the handler.
- **No reading a ref during render.** A ref is not an escape hatch from the
  rule above; both were rejected in turn while writing `WorkspaceTerminals`.

## Localisation

No user-facing string appears inline. Keys live in
[`i18n/locales/`](../src/renderer/src/i18n/locales/), English first — `uk.ts` is
typed against `en.ts`, so a missing key is a compile error.

**Delete a key when its last caller goes.** A key nothing reads is a claim about
the interface that has quietly stopped being true, and it survives every check:
`en.ts` types `uk.ts`, but nothing types either against the code.
