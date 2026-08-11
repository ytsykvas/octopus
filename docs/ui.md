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
the pane says which to pick rather than offering an input with nowhere to run.

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

**The header carries the subscription's window**, and only when it has something
to say. Measured against a live session, `rate_limit_event` usually carries no
`utilization` at all — a status, a reset time and the window's name. So the
header stays empty while everything is fine and speaks up when the window starts
running out, rather than parking a green dot and a countdown nobody asked for.
When a share does arrive it is shown. Which window it counts is never labelled:
the countdown says it already.

The reading is account-wide while the header belongs to a workspace, which is
deliberate — the decision it informs is made looking at the chat.

**Permission requests appear in the log**, where the user is already looking,
with allow / always / decline. A request read back from the transcript shows no
buttons: it was answered long ago, and offering them would let someone answer a
question nobody is waiting on.

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
a line saying what to do. One component rather than a copy per pane — the centre
and the chat each had their own and they had already drifted a few pixels apart,
on the screen a first-time user reads most carefully.

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

| Component                                                       | Worth knowing                                                                                                                                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Modal`                                                         | body has **no padding** — a list spans the full width, a form brings its own. A backdrop click does not close it. `lg` is a fixed height so sectioned dialogs do not resize between sections |
| `DropdownMenu`                                                  | positioned against the **window**, not its trigger — an absolute panel is clipped by any scrolling ancestor, and the tab strip is one                                                        |
| `Combobox`                                                      | a select with search; a native one stops being usable around thirty entries                                                                                                                  |
| `SectionRail`                                                   | the rail shared by both settings dialogs                                                                                                                                                     |
| `ProjectGlyph`                                                  | a project's icon, `aria-hidden`: wherever it appears the element around it is already named                                                                                                  |
| `Field`, `FileEditor`, `NameEditor`, `ResizeHandle`, `Terminal` |                                                                                                                                                                                              |

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
