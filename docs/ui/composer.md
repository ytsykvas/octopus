# The composer

**Escape stops a running turn**, as it does in Claude Code, and the button's
tooltip says so. Only once neither suggestion list has taken the key — those
return first, so the Escape that closes a list never also interrupts the agent —
only while a turn is running, since idle it would be a second way to do nothing,
and not while an input method is composing, where Escape cancels the candidate.

**The composer wears a colour ring while it has focus** — at rest it is an
ordinary 1px border like every other separator. Once focus is anywhere inside
(a click in the field, a click on one of its buttons, the keyboard), the
project palette fades in as a conic gradient around the frame, with a soft glow
outside it. It is the one deliberate exception to panes taking borders rather
than shadows (§10.2 of PROJECT.md).

Three layers. The line is a span of its own, `.composer-ring-line`, the
frame's first child: a square of the gradient, big enough to cover the frame
at any angle, clipped to the frame's rounded box. Over its middle, one level
up, the frame's `::before` is a fill of its own surface, so only the square's
outer pixel shows; beneath both, the frame's `::after` is the glow, the
gradient blurred. The fill is what keeps the glow outside — a mask cut the blur
off in a hard rectangle, since a mask clips at the edge of its own box. The
frame takes `z-index: 20` to hold those layers: `isolation` would have done it
at level zero, and the menus that open upwards out of the frame then slid under
the log's floating day chip. The same three layers draw the ring everywhere
else it is worn, from one block of rules in `styles.css`.

A gradient cannot be transitioned into a flat colour, so the plain border is
the frame's own and the fade is by opacity: the border to transparent, the line
and the glow up, over 0.2s. The line and the glow are also `visibility: hidden`
at rest, so a blurred layer nobody can see is not painted.

**The ring is also worn by the buttons that hand the work to the agent** —
"Ask the agent to describe it" in the pull request form and the pull request
pane's "Ask the agent" menu, both `Button`'s `agent` variant (`.ai-button`),
with a sparkle icon and the width of their words. There the line is faint at
rest and turns only under the pointer or keyboard focus, never the glow; once
the form's title has text, its button is the green "Open pull request".

**Nothing in the composer's ring moves.** It did: the line turned its
gradient's own angle (`--ring-angle`, registered with `@property` so it
interpolates) once every six seconds, measured at ~0.5% of a core on an empty
page and shipped on that figure. Measured again in the window with a log of
some thousands of nodes on screen, the same animation held 25–30% of a core
for as long as the composer had focus — which is most of the time — because a
registered property animating on the main thread recomputes style every
frame, and a frame costs what the page does. Turning the square by `transform`
instead, which the compositor does on its own, measured 14%, of which 9% is
what any animation at all costs this window: a 10px square turning alone
measures the same. The composer's line is therefore still, and so is the
agents chip's, which would otherwise turn for as long as an agent works. The
two buttons' lines still turn under the pointer, on the compositor, which is
brief. Reduced motion stops those with every other animation.

**The field is set in Menlo**, at 13px — `--font-prompt`, falling back to the
mono stack. A prompt is closer to code than to prose, and the maintainer chose
the face by eye; the log and the rest of the window stay in the sans.

While something is dragged over the composer, the ring steps aside for the plain
accent border: "let go here" reads the same everywhere. The strip around the
composer has more room above it than below, or the glow ran into the rule along
its top.

**The composer has an attic**, a strip above the field mirroring the settings
footer below it: how far this conversation is from compacting itself on the left, and
on the right the skills it may reach for, the paperclip, and a refusal when the
account has one. The reading is one step fainter than the pickers underneath,
which are clicked where it is mostly read — mostly, because it is also the way
out of what it reports.

**A saved prompt is chosen from a fan of pills over a button in the attic,
and is written into the field as text.** The button sits in the right-hand group,
ahead of the paperclip: both put something into the field, and the paperclip is
the least used of the strip. A prompt is **not** a command, and that is the
difference the whole feature rests on: `/ship` goes out as the characters
typed and is expanded by the CLI where the sender never sees what it said, while
a prompt lands in the field as text they can read and change before it goes. It
is written where the caret is, with the same spacing as a path
(`insertAtCaret` in `attachments.ts`, which `insertPaths` is now made of), so a
prompt dropped into the middle of a sentence reads as part of it.

The pills lie along a quarter of a circle above and to the left of the button —
the corner the composer's attic sits in is where there is room — and each flies
out of the button a rung after the one above (`fan-in` in `styles.css`). **As
many fit as fit whole**: a rung is kept only when its pill clears the top of the
area by the margin and the narrowest pill clears the left, so none is ever cut
off by an edge. The rest go behind a last-but-one pill, "More… (N)", which opens
a list of only what did not fit, under the sections "This project" and
"Everywhere"; the last pill is always the way to the settings that keep and order
them. That last one is **not a pill**: it is a larger circle with a gear and no
words, because it is not one of the prompts and should read as the fan's own
control, the same place however many prompts there are (it keeps its words in the
list). A prompt marked for the plan carries the plan's icon, the one the mode
picker uses, so the two kinds tell apart at a glance. The pills wear **the
project's colour** — the same wash as the sent bubble and the active tab — which
the component reads off the button when the fan opens and carries onto the fan,
since drawn into the body it is no longer inside the pane that sets
`--project-color`. The arithmetic is pure (`fanSlots` and `fanItems` in `chat/fan.ts`), so it
is tested as numbers and the component only draws.

**The order is the priority.** The project's own prompts come first, then the
installation's, each as the Prompts section lists them — so dragging one up in
Settings is how it is made easier to reach, and there is no second field for it.
The lists are read again each time the fan opens, which is why a prompt saved a
moment ago is there without anything telling the composer: a subscription would
be a second way for the same list to go stale, for a list looked at a few times
an hour.

With no room above the button at all — a window squeezed short — the fan opens
as the list, and nothing about it differs but the shape.

**A file is attached by pointing at it, not by copying it.** The paperclip is
one of four ways in: a file can be dragged onto the composer, added from the
Files tab's right-click menu or, for a screenshot, pasted straight into the
field. Each writes the file's **path** into the text **where the caret is**, as
if it had been typed there — §4's rule that nothing implicit reaches the agent,
in the plainest form it takes, and what makes the message the sender reads back
the whole of what was sent. There is no heading over it: "compare
`/a/shot.png` with" reads as one sentence, and a line announcing the files in
front of it read as the app talking rather than the sender.

A space is put on either side when the text there has none, so the path never
runs into a word, and the caret lands after it. A path with whitespace in it —
macOS names every screenshot that way — is written between backticks, or the
agent could not tell where it ends. Several paths at once go in a row, a space
apart (`insertPaths` in `attachments.ts`).

Nothing is copied anywhere, which is the decision the rest follows from. A copy
would put a second version of somebody's file somewhere they did not put it, and
it would go stale the moment they edited the original. Taking a path back is
deleting text, the way anything typed is. The paths waiting to be written are
held per conversation in `App` (`useAttachedFiles`), because the Files tab adds
to them from the other side of the window: the composer takes them as they
arrive and writes them at the caret its field last had, so a file added from the
tree lands where the sender left off rather than at the end.

**The strip above the field carries the review notes**, and it is drawn only
when it has something on it — the way the attic above it is. An empty rule over
the field would be chrome asserting that a review exists. It has room above as
well as below, or the notes touch the attic's rule and read as part of the row
above rather than as part of the message they are going out with.

The **paste** is the one exception and cannot be anything else, since a
clipboard carries a picture rather than a file. That one is written under
`~/.octopus/attachments/`, and that directory goes to every session as a root of
its own — so a pasted screenshot is read without a permission prompt, while a
file pointed at from somewhere else is a file outside the project and the agent
asks about it, which is right. A paste that also carries text is left alone:
copying a cell out of a spreadsheet puts a picture on the clipboard beside the
text, and the text is what was meant.

The **drop target is the whole box**, not the field. A textarea two lines tall
is a worse target than the frame around it, and a drop that lands a pixel
outside would do the browser's own thing — navigate the window to the file. The
frame says so while something is over it, and keeps saying so as the pointer
crosses the attic: `dragleave` fires for the parent when a child is entered, so
the naive version flickers.

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
  the middle of the tool calls, with a break the reader cannot see. `isEphemeral` in `core/events.ts` names the
  events that are not part of the conversation — the two streamed fragments, the
  rate limit, the command list, a rewind and a message waiting in the queue —
  and the log adds none of them as a row.
- **A refusal is named beside the numbers, never over them.** The first attempt
  had the account's status replace the percentages, which is what the old header
  chip did — fair there, where one number gave way to a word. Here it covered
  the two shares the strip exists for, and said less than they did. So only
  `rejected` gets a word now, because "the next turn will not run" is something
  no percentage carries; `allowed_warning` gets none, since "close to the limit"
  is vaguer than "Week 84%" and the colour already says it.

**A compaction moves the reading itself, not a request for it.** The figures on
the strip are pulled — three times a turn, and never on a timer, since the pair
costs about 700ms — but a compaction is the one moment the number is taken from
the event. Measured live: 74k tokens before and 16k after, with the reading
sitting where it was until the next message. That is the reading contradicting
the thing it exists to justify, and someone who compacts to make room and sees
no change runs it again for another minute and another dollar. The figure comes
from the boundary's own `postTokens`, which is right whether or not the agent's
own accounting has caught up, where asking again would put the stale number
back. It is counted to the same point the reading counts to, or the figure would
jump when the next turn read it again. The log gains a line for the same event,
beside the one `/clear` draws.

**The share counts to where the agent compacts, not to its window.**
`getContextUsage` answers `percentage` against the window (`maxTokens`), but the
agent acts at `autoCompactThreshold`: the window less the room a summary needs,
13 000 tokens in 2.1.311. A 500k conversation at 456k read 91% and sat there,
which looked like an agent that had stopped compacting; counted to the threshold
it reads 94%, and the next turn is the one that compacts. So `readContextUsage`
counts the share itself (`contextShare`, never past 100, since the context can
sit beyond the line until the turn that acts) whenever the agent names a
threshold, and keeps the agent's own percentage when it does not — switched off,
which also sends no threshold, or a CLI that predates the fields. The tooltip
names the point beside the counts.

**Clicking the context share opens the two commands that change it.** It is the
one figure on the strip that can be acted on — the account's windows empty on a
clock nobody here controls — and what acts on a full context window is
`/compact`, which keeps a summary and carries on, or `/clear`, which throws the
conversation away. Neither is dispatched: they go out as the text of an ordinary
message, which is what a slash command is in this app, so the menu hands them to
the same `onSend` the field uses.

**The same menu chooses where the conversation compacts itself**: _Auto_ and
300k, 400k, 500k, 600k, 800k, as radio rows in a group of their own between the
two commands. Left alone, a 1M model compacts near 967k, by which point every
turn pays for a context it mostly no longer reads. The menu is wider than the
app's others (`width` on `DropdownMenu`) so the group's notes fit, and the group
says, most pressing first:

- that **auto-compact is off** — `DISABLE_AUTO_COMPACT`, `DISABLE_COMPACT` or
  the `autoCompactEnabled` setting, as `isAutoCompactEnabled` reports it — as a
  warning. Nothing fires, so no window is in force and the note outranks the
  ones below, which would describe a choice with no effect;
- that **`CLAUDE_CODE_AUTO_COMPACT_WINDOW` decides instead**, naming the value
  and where it is set — the environment, or the `env` block of a settings file
  the session reads. Measured, it outranks anything a session is told. The rows
  stay choosable: a running session keeps the variable after it is taken out,
  so a choice — the same window included — is what starts one that notices;
- that a choice made mid-turn **takes effect with the next message**;
- **what is in force when it is not what was chosen** — a measurement from
  `getContextUsage`, not a guess, so a disagreement is said rather than hidden
  behind the tick. The CLI also takes the variable from a settings file while a
  session runs, which the start could not see, and keeps it once taken; choosing
  the same window again then starts the session over too, so a new one looks at
  the files as they are. The rule for "not what was chosen" is `windowStrayed`
  (`chats.ts`), which the menu and the core both ask — the core against the
  window the session was started with, so a choice still waiting for its turn
  is not taken for one. Auto has nothing to stray from, so a variable taken
  mid-session under Auto is shed only by choosing a window. The note says
  choosing again starts the session over, and stops saying it once a session
  started over for that very reading has read it again: a stray no new session
  clears — a model holding less before any turn has said how much, a managed
  settings file the start does not read — costs one restart to find out, and
  choosing it again after that changes nothing;
- failing all of those, **where it does compact**, from the same threshold the
  strip counts to.

A window above what the model holds is greyed with that figure, since the
agent would cut it down anyway. _Auto_ says what it amounts to while it is the
choice. Choosing starts the session again (see `setChatAutoCompact`); the
reading is then asked for again, because "Context N%" counts to the point the
window puts the compaction at. The old process ends with SIGTERM, which the SDK reports as a failure;
a session closed on purpose says nothing of it, so the restart leaves no error
in the log.

**A process that died is said in words.** The SDK's failure is "Claude Code
process exited with code N"; the row says instead that it was stopped from
outside (a code above 128 is a signal) or stopped with an error and its code,
that a message carries on, and keeps the SDK's line under it in small print.
Read from the text by `exitCodeOf`, so logs written before it read the same.

**The agent's task list is pinned above the field while it has work left.** A
long turn is mostly the agent working through a list it wrote for itself, and
from the log that progress is a scatter of tool rows. The panel is the same list
as one line — "Tasks · 3 of 7 · Running the tests" — that opens to the whole of
it, each item with a mark and, for a reader who cannot see the mark, its state
in words. It is replayed from the agent's calls: a current CLI keeps the list
with `TaskCreate` and `TaskUpdate`, one line per call, and offers `TodoWrite`
only when `CLAUDE_CODE_ENABLE_TASKS=0` is set — a 2.1.299 session had no
`TodoWrite` at all, so while only that was read the panel never appeared.
`TodoWrite` still replaces the whole list when it is used. A created task joins
once its result names its id, the one thing later updates refer to it by. The
panel is shown **only while the agent is working**: a list
left with items pending (interrupted, errored, abandoned) would otherwise stay
pinned across every later turn and every restart, describing work nobody is
doing, and the log still holds it. In the log, a `TodoWrite` row draws the list
it wrote as a checklist under itself, as Claude Code does, through the same
`TodoChecklist` the panel opens to; `TaskCreate` and `TaskUpdate` are ordinary
rows naming the task and what it moved to. A list written by a subagent is skipped —
it is its own task's, and its calls would otherwise rewrite the conversation's.

**A heads-up can sit in the same place between turns.** "✦ Heads up · …" is a
caveat shown at the moment it starts to be true of this conversation, the way
Claude Code shows its own. The first one says that rewinding files undoes only
what the agent changed with its editing tools: the SDK's checkpoints do not see
what a command did, so it appears once the agent — or one of its subagents —
has run `Bash`. It waits for the turn to end rather than pushing the field up
mid-answer, and only one is shown at a time. **Learn more** opens a paragraph in
place; **Add to chat** puts what is on screen into the message field — the one
line, and the paragraph as well while it is open — after whatever is already
written, on a line of its own, and hides the heads-up for this conversation,
since a second press would put the words in twice. It is on every heads-up, not
only this one, because it reads the tip's own `title` and `detail`; the text goes
in the language the window is in. A caveat about what the agent cannot undo is
often what the next message is about, and retyping it is the part nobody should
have to do. It is the composer's `seed` again — the channel a rewound message
comes back through — with `append` set, because a rewound message _is_ the draft
and this is only added to it: replacing would throw away a half-written question.
**Knew this already** stores the id in the config's `dismissedTips`, for
every conversation; **Dismiss** hides it in this conversation for as long as
its workspace stays open — the conversations are rebuilt when another workspace
is chosen, and it comes back with them, which is what tells the two buttons
apart. Each button has an icon — a chevron that turns over with the paragraph
it opens, a speech bubble with a plus, a check, a cross — hidden from a screen reader, since the words beside
them say it. Claude Code's number keys are left out: the field below takes
text, and a digit there is a digit. A new heads-up is one entry in
`components/chat/tips.ts` — an id and the condition on the log — and its
`title` and `detail` under `tips.<id>` in the locales.

**Typing `@` offers the session's subagents.** Read at the caret like a
command, only when the `@` starts a word — inside an email address it would be
noise. The list is the one the chat's session announced when it started
(`agents_changed`), so it holds Claude Code's own (`Explore`, `Plan`), the
project's `.claude/agents/` and a plugin's under its qualified name. A pick
writes `@agent-<name>` into the text: Claude Code turns that into an
instruction to hand the work to that agent rather than leave the choice to
Claude — measured through the SDK, not only the CLI — and the message the user
reads back says so. Typing the written form (`@agent-Exp`) finds the same row.
Files are not offered: they are written in with the paperclip, a drop, a paste
or the Files tab, and an `@` list of paths was a fifth way in nobody used.

**Typing `/` offers commands, and where it is typed decides which.** The word
is read at the caret, like a mention, and only when the slash starts a word —
so `src/core/`, a date or a pasted path opens nothing (`components/chat/suggest.ts`).
At the very start of the message every command is offered, since that is the
one place Claude Code runs one. Anywhere else only **skills** are: a skill named
after plain text is permission for Claude to run it in that reply, while a
built-in such as `/clear` mid-sentence does nothing, and offering it would be
offering a mistake. Which commands are skills is not in the command list —
`SlashCommand.builtin` marks the bundled skills as Claude Code's own too — so
the session marks them from its `init` message's `skills`, and announces both
lists itself (`commands_changed`, `agents_changed`) once that first `init` has
arrived — asked any earlier, every command read as no skill. A pick replaces the word and
keeps the sentence around it; mid-sentence it always gets a trailing space, at
the start only when the command takes arguments. Escape dismisses the list for
that one word: the caret moving on to another `/` brings it back.

**A command name is not unique**, and both places that use one had assumed it
was. The agent can report two under one name — seen live, twice for
`code-review` — so the menu keys a row by its name _and_ its place in the list,
and the alias lookup reads every record with that name rather than the first.
The second is the one that mattered: it decides whether a message is intercepted
or reaches the agent, so a duplicated `clear` meant `/reset` went out while the
log stood, claiming a history the agent no longer had. Neither de-duplicates —
octopus is a harness, and dropping one would hide a command somebody wrote.

Two commands are noticed on the way past, both in `core/chats.ts`.
`isClearCommand` only watches — the message still goes, and knowing it went lets
the service drop the transcript when the reset comes back. `isUsageCommand`
takes the message instead: `/usage` is answered from the session's structured
reading and never reaches the CLI, because the CLI's own answer is a paragraph
of prose about percentages. It is drawn by `UsageCard`, the only place in the
app that shows the session's cost.

`/btw` is taken before either of them, by the composer itself
(`Composer.submit`, through `parseBtw`) and on the typed text, before the notes
are wrapped around it — wrapped, `/btw` would no longer lead the message. The
question goes to the side drawer, the field clears and the notes stay for the
next real message. Bare, it opens the drawer on the thread so far.

## Side questions

The bump on the edge between the chat and the right panel, level with the top
of the composer, pulls out a drawer of side questions (`SideQuestions.tsx`). It
is placed by the composer's wrapper rather than the whole pane, so it never
covers the log's scrollbar. The bump is drawn in the project's colour and bends
the separator into the chat; it sits on the chat's side of the line, so it stays
when the right panel is folded. The drawer lies over the chat — nothing under it
moves — and closes on a click anywhere else or Escape, but only for the
conversation on screen and not while a dialog is open. Focus returns to where it
was unless the click that closed it moved it, and neither move of focus scrolls
anything; the newest exchange is kept in view by the drawer's own list. It has a
field and a send button and nothing else: no model, no effort, no mode, because
a side question uses the session as it is.

Each conversation has its own thread, held for the window by `App`
(`useSideQuestions`) so it survives the pane being rebuilt, and lost when the
app quits, as the CLI's is. A thread is dropped when its conversation is cleared,
rewound or closed: replayed, it would hand the agent context it no longer has.
Questions do not wait for each other. An answer that lands with the drawer shut
marks the bump and its name, and what the CLI wrote itself rather than the model
("no answer available") is drawn quieter.

Under each answer the model gave, a branch button continues from it, as the
CLI's `f to fork` does. It opens a new tab that continues the conversation with
the question and its answer as the last exchange, and moves to it. The drawer
goes once the tab is open and stays when the fork is refused. Only one fork runs
at a time, so a second click cannot open a second tab.

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
