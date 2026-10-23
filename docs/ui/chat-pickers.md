# The model, effort and mode pickers

**The footer names what the next message will actually run in.** A conversation
with no record yet has no stored mode, and the record is created from the
settings — so that is what the pickers show until it exists, handed down from
`App`, which is where the config is read. Showing the schema's own defaults
instead made the control lie about exactly one message: the first, which is the
one the user has not sent yet and is looking straight at.

**The effort panel sets two jobs from one scale**, through a pair of tabs:
planning, and writing code — in that order, because the plan is the choice and
the writing may follow it, as in the model panel. Tabs rather than the second marker on the scale that
was the other candidate — the scale is one `role="slider"` with one handle, and
two handles on it is the range pattern, which these two are not: planning may
sit either side of the work, and `aria-valuenow` has room for one answer. Two
scales side by side was ruled out before either: two octopuses in a window that
argues for calm, and the picture is most of the panel's height.

Each tab carries its own level underneath its name, so the half that is not on
screen still says what it is set to — which is most of why the pair is there
rather than one scale silently setting whichever job is running. The panel opens
on the half that is actually running, so the picture above it is the one the
chip named, and the chip names the level in force rather than the working one
whatever is happening.

While the two share a level the writing tab says `Same as plan`, and a move on
the planning tab moves both. Under the writing tab and nowhere else, one quiet
button returns the pair to a single level — the plan's. A split is the
exception, so undoing it has to be a click rather than a hunt for which tick was
there before.

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

**The writing column's first row is what makes the split optional.** The plan
is the choice, so the plan column is a plain list, and `Same as plan` heads the
writing column. It is ticked until someone says otherwise, and while it is, a
pick in the plan column moves both jobs and the conversation runs one model,
exactly as it did before it could hold two. The row names the model it resolves
to underneath, because that is the fact a reader opening the panel came for.
Picking a writer of its own is what splits the pair, and the plan keeps the model
it was on. What each click does to the two stored fields is `choosePlan` and
`chooseWork` in `chats.ts`, which Settings' default models go through as well.

**The chip names the model in force**, which is the plan model while planning a
conversation whose two differ, and the coding model everywhere else. The effort
control follows the same reading — so a plan model that takes no effort greys it
out for as long as planning lasts, and gives it back afterwards.

**The three settings in the row do not all behave the same way, on purpose.**
The **model** is read back: the context reading names what the session is
running, so `/model opus` moves the chip and the record stays what was chosen
here — `/model opusplan` aside, which the record follows (below). The **mode**
and the **effort** are re-asserted on every message instead, because neither can
be read — no SDK message reports the effort, and `applyFlagSettings` answers
nothing. So `/effort high` and `/permissions` last one turn each: the control
names the level the next message will run at, which is the reading that matters
at the moment anyone consults it.

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
`result`, so the chip moves as soon as the command's turn ends. The panel keeps
ticking the record and says so in a line above the columns ("This session is
running Sonnet: /model chose it for this session only"); without it the panel
read as the model the next message runs on, and the chip contradicted it. Two
things keep the line from blaming a `/model` nobody typed. A pick in the panel,
a plan model or a mode moves the session at once, so the reading is taken again
as soon as the core has applied it, and the model it named before is forgotten
until then — it waited for the next turn's result, and the panel, open after
the pick, named the model just left. And with no catalogue yet there is no line:
the default row has no model behind it to compare with.

**`/model opusplan` is the one command the panel follows.** The alias means Opus
while planning and Sonnet otherwise, which is precisely a split, and left to the
rule above the panel ticked Opus on both rows while the session ran two models.
So once the message is accepted the chat's two models are set to that pair, and
the panel shows it: the plan column ticks Opus and the code column Sonnet. Which
rows those are is the catalogue's to say (`opus[1m]` where there is no plain
`opus`), and where it cannot express the pair nothing changes. Any other
`/model` still moves only the chip.

The pair is written planning first and stops at a refusal, so a failed write
never leaves half of it: the panel is either as it was or has the planning model
set and the writing one on the default, with the error on the banner.

**The footer's mode is one control over two stored fields.** `plan` is not a
third degree of permission but a state the conversation is in: the agent runs
no tools at all in it, so `Accept edits` has nothing to accept. Held as one field
they could not both be true, which is why approving a plan once had no mode to
return to — and why a toggle stayed lit over an agent that had started editing.
So the record keeps `planMode` beside `workingMode`, and the composer shows the
two as one control beside send: `planMode` wins when it is on, and the working
mode is what shows otherwise. A new conversation starts with `planMode` on — the
composer shows Plan before the record exists, to match what the first send
creates — and a fork starts with it off.

It **switches in place**, going round `Manual` → `Accept edits` → plan →
`Auto` → `Manual`: the ring Claude Code's own shift+tab goes round, and
Shift+Tab in the field does the same here. There used to be two controls — the
permission chip among the pickers and a plan toggle by send — and each said
half of what this says. The pickers beside it keep their menus, because their
lists are open-ended. Each mode has its own colour, so it reads without the
word: `Manual` is untinted, `Accept edits` amber (the `warning` token, the
app's "goes ahead, take note"), plan in the accent, and `Auto` green with a
bolt — the one mode where a classifier rather than a rule decides. The tints
are `MODE_TINTS` in `Composer.tsx`.

Leaving plan for the next mode moves the working mode **before** planning ends.
Planning holds a working mode underneath — `acceptEdits`, when the ring reached
it the usual way — so turned the other way round the session would pass
through it, and an edit landing then would go through without what the next
mode asks for. `setMode` in `useChat.ts` owns that order so no caller has to
know it.

**A plan approved out of planning goes on in the mode Settings names** —
"Carrying out an approved plan", `Auto` by default or `Accept edits` — whatever
the conversation was asking before. The core writes both fields when the plan
tool is allowed, and executing a plan from the log does the same; the rule is
`modeAfterPlan` in `chats.ts`, shared by both. With one control there is no
second one left to say what should follow a plan, and a plan read and approved
is the edits accepted in advance — which is why `Manual` is not offered there.
Because that widens what the agent may do, the plan dialog says so beside its
button, before the click.

The dialog's note field sends on Enter, as the composer does, and also has the
composer's own send button (`SendButton`, green like every send) in its corner.
It is never disabled: a plan sent back with nothing written is still an answer.

Beside Execute (green) sits **Fork in new chat** (the accent): the plan is
carried out in a fork of the conversation while this one stays in planning.
`useChatTabs.forkPlan` forks, moves the fork to the mode above, sends it the
plan — the rewrite in full when the user edited it, since the fork never saw
it — and only then shows the tab, so the pane reads the message with the
history. The source's turn is then stopped rather than answered: either answer
would set its agent working again. A fork that fails to start leaves the
question standing. Both buttons are held while a fork is on its way.

**Only out of planning, and never down from `Auto`.** The agent may call the
plan tool from any mode, and handing over there would let it raise a
conversation set to `Manual` into one that does not ask, by asking once.
Outside planning, approving changes no mode and the dialog carries no such
line. A conversation already in `Auto` goes back to it whatever the setting
says, as the CLI itself does.

**`Auto` is the SDK's `auto` mode**: a classifier approves or refuses each call,
and what it cannot decide still comes to the chat as a question. What it
refuses is drawn as a line in the log ("Auto mode blocked Bash", with its
reason), from the SDK's `permission_denied` message — without it a blocked call
shows only as a tool that failed. Not every account, model or setup has it. A
switch to it that the SDK refuses comes back as an error and the chip stays
where it was. A conversation already in it that loses it — the CLI starts a
session in `default` silently, or refuses it on a later message — falls back
with a line saying so: to `Accept edits` when auto came from carrying out a
plan, to `Manual` otherwise. A report of `default` from the session is not
taken as that verdict on its own; auto is asked for again first, and only a
refusal falls back.

`Manual`, `Accept edits` and `Auto` keep their English names in every locale —
they are what Claude Code's own status line calls the modes, and a translated
name for a borrowed one reads as a second setting rather than the same one —
Settings names them the same way. `Accept edits` was once labelled `Auto mode`,
before Claude Code gained a mode of that name; the two are different things:
`acceptEdits` accepts file edits and the plain filesystem commands (`mkdir`,
`touch`, `rm`, `mv`, `cp`, `sed`), not commands in general.
