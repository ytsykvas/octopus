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

Its header says which workspace by naming the **branch**, marked with a branch
icon, and nothing else. It used to carry the name as well: a workspace branch is
made from the workspace name, so `anna ytsykvas/anna` was the same word twice —
and the branch is what a workspace is identified by anyway. The icon is there
because nothing else in the pane says what that string is.

The chat draws **one row per event**, not one bubble per turn. A turn is mostly
tool calls, and folding them into the prose hides the part that says what the
agent actually did to the working tree. Reasoning is folded away, a successful
tool result is not shown at all — the output of a `Read` is the file, and pasting
it in would bury the conversation in the codebase.

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

**The composer's two rows wrap rather than overflow.** The centre may be dragged
down to `MIN_CENTRE_WIDTH` (360, in `RightPanel.tsx`), and at that width the
footer cannot hold its three settings and the send button side by side. It used
to run past the rounded border and take the send button off the edge of the
block — Enter still sent, but the pane's primary control was not on screen. Each
control carries `min-w-0` rather than `shrink-0` for the same reason: `truncate`
on its label could never fire while the button refused to shrink. What gives way
is the wording, and only after the row has already used a second line.

**The composer has an attic**, a strip above the field mirroring the settings
footer below it: how full this conversation's context window is on the left, how
much of the subscription's five-hour and weekly windows is gone on the right.
Both are read one step fainter than the pickers underneath, which are clicked
where these are mostly read — mostly, because the left one is also the way out
of what it reports.

It used to be one figure in the chat header, and it was almost always blank.
Measured against a live session, `rate_limit_event` usually carries no
`utilization` at all — a status, a reset time and one window's name — and a
single event can never hold both windows anyway. The attic asks the running
agent instead, which answers with both.

Two rules there are worth keeping:

- **The strip vanishes when it has nothing to say**, rather than standing empty.
  A workspace nobody has spoken to, an API-key session with no plan windows and
  a CLI too old to answer all get the composer as it was. An empty rule above
  the field would be chrome asserting that a measurement exists.
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
the same `onSend` the field uses. `isClearCommand` in `core/chats.ts` is the only
thing octopus notices about one, so the service can drop the transcript when the
reset comes back.

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
  be copied up here: `usageTone` paints the figure at 75% and again at 90%, and
  a hover that repainted it would put the control's state over the measurement.

The windows are named here (`5h`, `Week`) although the old header chip never
named its one: two figures side by side are unreadable without labels, while one
figure beside a countdown was not.

The reading is account-wide while the header belongs to a workspace, which is
deliberate — the decision it informs is made looking at the chat.

**What the agent looked at folds; what it changed does not.** A run of tool
calls becomes the count of them, closed, opening on a click — the same
disclosure reasoning gets. A turn is mostly tool calls; one rename went through
fifty-nine, and a line each buried the two things worth reading. A lone call
stays in the open, since "1 step" costs more to read than the row it replaces,
and a failure or anything the agent said breaks the run so it stays where it
happened.

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

**Every row of the model picker names a model.** The catalogue's first entry
does not: the CLI calls it `Default (recommended)`, which tells a reader nothing
about what they are about to talk to. It does say what it _resolves_ to, and the
catalogue carries a second row for that same full name — so the default row
wears that row's name and is marked `by default` underneath, and the duplicate
is folded away rather than drawn twice under one heading. `modelRows` builds
this, over `defaultAgentModel` in core. A chat that chose nothing ticks that row,
which is why there is no longer an `Agent decides` entry beside it: the two said
the same thing, and only one of them could name a model.

Before any session has reported a catalogue there is no name to wear, and the
row reads `Default model` — words rather than the raw `default` the picker would
otherwise print.

**The button names what is running when that differs from what the menu ticks.**
A `/model` command is what causes it: the CLI scopes it to the session ("for this
session only"), so it moves what is running without moving what this chat chose
— and the record staying put is the truth rather than a compromise. The name
reaches the footer with the context reading, which is already refreshed on every
`result`, so the picker moves as soon as the command's turn ends. When the two
agree the button simply says the ticked row, because saying it twice adds
nothing.

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

**The right pane** holds Changes, Terminal, Build and Server. Build runs
`setup.sh`, Server runs `run.sh` with the workspace's port in `$OCTOPUS_PORT`.
Both run on a button: starting a server because a tab was clicked is a surprise.

The right pane folds away from **one button in the title bar**, which switches
between collapse and expand in place. The collapse used to sit inside the pane
and the expand in the bar — but a control that folds something away cannot live
inside it, or once folded there is nothing left to click, and the way back has to
be hunted for somewhere else.

Both side panes are resizable and their widths persist. The right pane's floor is
**measured, not chosen**: it is whatever its four tabs need. The labels change
width with the language, a number picked against English left the Ukrainian ones
overflowing, and since the pane does not shrink, anything sticking out of it
pushed the window wider and put a horizontal scrollbar under the application. The right pane's ceiling
is whatever the window has left after the sidebar and a usable centre, so it
grows on a large display without a number to maintain.

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

| Component                                                       | Worth knowing                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Modal`                                                         | body has **no padding** — a list spans the full width, a form brings its own. A backdrop click does not close it. `lg` is a fixed height so sectioned dialogs do not resize between sections; `md` grows to the window less a margin, because what it carries is read rather than filled in — a plan, a list of repositories — and height is how much of it you see at once  |
| `DropdownMenu`                                                  | positioned against the **window**, not its trigger — an absolute panel is clipped by any scrolling ancestor, and the tab strip is one. Widens itself when its items carry a second line, and wraps that line to two rather than truncating: the model descriptions come from the agent, and one written for a width chosen for one-word commands says nothing when cut short |
| `Combobox`                                                      | a select with search; a native one stops being usable around thirty entries                                                                                                                                                                                                                                                                                                  |
| `SectionRail`                                                   | the rail shared by both settings dialogs                                                                                                                                                                                                                                                                                                                                     |
| `ComposerPicker`                                                | one setting in the composer's control row. Ghost, not `Button` — a bordered control on that surface reads as a chip, and three of them make a toolbar competing with the field above                                                                                                                                                                                         |
| `Markdown`, `CodeBlock`                                         | how the agent's own output is drawn. A fenced block gets a frame and a copy button in its own row, never floating over code that scrolls sideways. The block/inline distinction is taken from `pre`, not from the language class: a fence with no language hands the `code` override exactly what inline code does                                                           |
| `Settings`                                                      | `initialSection` opens it where the caller needs it. Read once, on mount — correct only because `App` renders the dialog conditionally, so a close unmounts it                                                                                                                                                                                                               |
| `ProjectGlyph`                                                  | a project's icon, `aria-hidden`: wherever it appears the element around it is already named                                                                                                                                                                                                                                                                                  |
| `Field`, `FileEditor`, `NameEditor`, `ResizeHandle`, `Terminal` |                                                                                                                                                                                                                                                                                                                                                                              |

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
