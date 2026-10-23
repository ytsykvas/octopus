# The account and the status bar

**The foot of the left column is one footer**, as wide as the strip and the list
together: the account's limits, and under them a row holding Settings and the
fold, both icons. The two are the controls that belong to the window rather than
to any project, so they share a row — Settings at one end, the fold at the
other. The footer is the part of that column which survives folding, so the
control that brings the list back belongs to it rather than to the pane it
hides, and it sits outside the scrolling list of projects or it would scroll
out of reach once there are enough of them.

Folded, the column is only the strip: the limits are not drawn, and Settings and
the fold stack instead of sitting side by side. The label on Settings went with
the move — beside an icon it was a word restating the icon, and the name is
still there as a tooltip and for assistive technology.

## What is left of the account, at the foot of the left column

The account's plan windows sit at the foot of the left column — under the tab
strip as well as the workspace list, in the footer beside Settings — rather than
above the composer, where they used to be. They say nothing about the
conversation they were sitting in: the same set applies to every workspace, and
the decision they inform is whether to start something at all, which is made
looking at the list rather than at a chat.

**They are there before the first message.** The service keeps the last reading
in `state.json`, beside the model catalogue and for the reason already written
on that field: so something is usable before the first message. It is a second
of staleness now rather than a launch of it, since the first read lands as soon
as the window opens — but a block drawn empty for that second would
flicker on every launch.

**It is polled, and it will start a session to answer.** This is a reversal, and
the thing that reversed it is a measurement. The rule was written on the
assumption that answering costs an agent; a cold read — spawn the CLI, ask,
answer — is **720–850ms**, one against a session already running is about
**260ms**, and neither costs a token, because it is a control request rather
than a turn. (Measured on SDK 0.3.224. See the note on `skipBehaviors` below
for what a read costs today and why it is a different number.) Three things
keep the figures current:

- **the service announces a reading that moved**, so a finished turn reaches the
  block on that turn;
- **showing the window again asks**, because whatever happened while it was
  hidden announced itself to nobody here, and the figure informs a decision
  taken the moment somebody looks;
- **a slow timer while the window is visible** — three minutes — for the window
  left open and watched. Stopped while it is hidden: nothing behind a hidden
  window is worth spawning a process for.

Focus alone asks nothing. A window that stayed visible kept its timer, so the
figure is at most three minutes old when somebody switches back to it, and
asking on every focus started the CLI once per switch between apps — twice on
a return from the Dock, which fires a visibility change and a focus together.

The control stays, because a press is still the right way to ask _now_. What it
no longer is, is the only way.

**None of the three runs while the list is folded away.** The block is drawn by
a component that exists only while the list is open, so folding stops the timer
and the focus listener with it, and unfolding is a coming back: it asks at once.
`SidebarFooter` is where that is arranged — the footer itself is always there,
because Settings and the fold are, and only the block inside it comes and goes.

**The block asks for the windows and nothing else.** The same control request
also scans the machine's local transcripts to say what has been eating the
limit — the card's `contributing` section — and a read of a heavy user's
history is most of its cost. Measured on SDK 0.3.299, against a session already
running: **~515ms** a read with the scan and **2–16ms** without it, the
endpoint's own answer being kept for about a minute by the CLI. So the block
passes `skipBehaviors: true` and a typed `/usage`, the one place that section is
drawn, does not. The 260ms above predates this and is no longer what a read
costs.

**Which CLI answers is the SDK's, not the terminal's.** The binary that runs
is the platform package beside the SDK — `claude-agent-sdk-darwin-arm64`, of
the SDK's own version — and a `claude` installed on the machine is a different
build that may behave differently. `pathToClaudeCodeExecutable` is set only in
the packaged app, and only to the unpacked copy of that same package
(`agentBinary.ts`). Between 0.3.224 and 2.1.299 the usage client changed in ways that
matter here: 2.1.299 keeps a successful answer for about a minute and says so
("answered from a snapshot … endpoint not asked"), honours a 429's
`Retry-After` and does not ask again for 3–5 minutes, and logs which of those
happened. 0.3.224 asked every time and met refusals as an empty 200. Both still
fall back silently when the endpoint refuses — the SDK's response carries no
provenance in either — so the rest of this section holds on both.

**Reads are coalesced, and a session started to answer is closed again.** All
four askers can land at once, and each starting its own read would spawn its own
CLI to ask one question, so the one in flight is shared. And a probe is shut in
a `finally`, which it was not at first — one press left an agent running for the
rest of the session, and that would now be one more every three minutes.
**The timer says it is not a press** (`refreshSubscription(pressed)`): with every
session let go for resting, it would start that probe every three minutes to
read figures nobody has been moving — the very process the release saved — so
with no session running it is answered from the reading kept, as long as that
is younger than the release itself; a press is a question, and always asks.

**The account's endpoint refuses most requests, and the CLI does not say so.**
Measured against a live account: `GET /api/oauth/usage` admits about one request
in two minutes, shared by every process holding the token — this app's polling,
a turn ending, and a terminal `claude` all draw on the same one. A refused
request comes back as HTTP 200 with a body that has no windows in it, and the
CLI answers from a fallback without saying which: the rate-limit headers of the
last model response _that process_ saw (five-hour and weekly shares only), or a
copy in `~/.claude.json` that is written at most every five minutes and trusted
for an hour. The SDK passes on the figures and drops the provenance, so a
reading cannot be told from a stale one at this end.

Two things follow, and both are in the code. **The session asked is the one
that spoke last** (`freshestSession`, counted by `spoke`), because that is the
one whose headers are current; a session that has sat idle falls back to what it
saw when it last ran, and the first one started was asked every time whatever it
had been doing. And **a reading silent about per-model windows keeps the ones
already drawn** (`modelWindowsKnown`, `windowsFrom`): an answer built from
headers has no `model_scoped` at all, which is not the same as an empty list,
and drawing it as it stands made the Fable bar vanish until the next full read.

A probe with no session running has made no request, so the headers it could
fall back on do not exist and it is left with the cached file. That is the
remaining way for the block to lag, and it is a property of the CLI.

**The slot for the read in flight is emptied from outside the read.** It was a
`finally` inside it, which for an answer that awaits nothing — "nowhere to ask"
— ran before the promise was stored: the slot was cleared and then filled with a
promise already settled, and every later caller was handed that one sentence for
the rest of the run.

**A figure that is not live says how old it is.** The answer carries no
provenance, so it is worked out from what each source guarantees. An answer
with no per-model section was built from the headers of that session's last
model response, and is as old as it (`modelHeardAt`, set only by events that
mean the model spoke — a session that has only announced its commands has heard
nothing). Any other answer is the endpoint's or the CLI's copy of it, and the
copy's date is read from the CLI's config file (`cliUsageCache.ts`): it is
rewritten on every successful fetch at most every few minutes, so one older than
six minutes means no fetch has succeeded since and the figures are that old.
Younger, or live, says nothing — a footnote on every read would be the one
everybody learns to skip. The line is a sentence under the bars, `As of 25m
ago`, with the reason in its tooltip.

It rests on a file the CLI does not document, which is why it can only ever
_add_ a line: a file that is missing, unreadable or shaped differently reads as
null and the block is drawn as it was. One thing it cannot rule out is the
CLI's process holding its config in memory while another process rewrites the
file, which would make a figure look fresher than the session's copy; the
failure is the one the block had before, not a new one.

**A probe is the app's own session, not the conversation's.** It borrowed one at
first — started through the same function a message uses, which registers it in
the session map under a real conversation's id. Three things followed, and the
gauge showed none of them: a message sent while the probe was out was handed to
the probe and then killed by its `finally`, taking the turn with it; a `/clear`
sent that way left the conversation armed to discard its transcript on the next
reset it saw; and a probe that could not spawn wrote a red row and the agent
binary's name into whichever conversation was created last, in any project.

So it now starts a session of its own: nothing in the map for a message to
adopt, an event sink that drops everything rather than the handler that writes
transcripts and statuses, and no settings sources — a usage figure belongs to an
account rather than to a repository, so a repository's hooks do not run for a
gauge.

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

**The account can talk it down from a colour, and cannot raise one.** Those
thresholds are guesses; `rate_limits.limits[]` carries the server's own
`severity` for each window, and the server is not guessing. So a severity we
recognise wins over the threshold, and the only one we recognise is `normal` —
because it is the only value a captured response has ever carried, and
inventing `warning` and `critical` beside it would be this app guessing again in
the very table meant to stop it. The asymmetry is the right way round: an
account saying a window is fine at 95% quiets a red that nothing else would have
withdrawn, while a word nobody has seen cannot invent an alarm.

**And the binding window is marked, not moved.** The same array says which
window is the one actually stopping the next turn. Three drawn at equal weight
left the reader to work it out; reordering the list to answer would cost them
the positions they have learned, and a word costs nothing. The card has room for
one of its own; the footer row is the width of the column and not much more
than two hundred pixels at its narrowest, so there the mark rides on the name.

The two readings are joined by **reset time**, not by name. The vocabularies do
not line up — `session` for `five_hour`, `weekly_scoped` for a model's week —
and the timestamps do, to the microsecond, on a captured response. A window
whose entry is a different window gets nothing, which is the answer that
matters: a severity attached to the wrong row is worse than none at all.

## The status bar along the foot

How every project is doing, in one 22px line (§10.8 of `PROJECT.md` says what is
on it). Three things about it that the code alone does not say:

**A count of nothing stays.** A segment at zero is drawn in the faintest ink
rather than hidden, so the figures do not move about as work starts and stops,
and a reader learns where each one lives.

**It reads only while it is looked at.** The machine is asked every ten seconds
through `useVisibleInterval`, which stops while the window is hidden or
minimised and asks at once when it is shown again — a switch between apps
asks nothing, since the clock never stopped; the other projects' requests ride
on `useBranchRequests`, and only while the bar shows. Folding it away is the
switch for somebody who would rather the app did not run `ps` at all.

**A reading redraws the bar and nothing else.** The bar takes the machine's
reading itself, rather than `App` holding it — every reading differs from the
last, and held in `App` it redrew the whole window every ten seconds, every
open conversation included. A request read that brings nothing new leaves the
state as it was for the same reason.

**What floats in the corner sits above it.** The root sets
`--status-bar-height` while the bar shows, and the notices add it to their
bottom offset — without it the newest notice covered the right end of the bar.
