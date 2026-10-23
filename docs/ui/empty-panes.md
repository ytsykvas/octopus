# Empty panes

`Placeholder` is the one component for "nothing here yet": the mascot, a title,
a line saying what to do, and optionally the buttons that do it. One component
rather than a copy per pane — the centre and the chat each had their own and
they had already drifted a few pixels apart, on the screen a first-time user
reads most carefully.

**Every pane that would otherwise be empty uses it** — the centre, and in the
right column the Terminal, Changes, Files, Scripts, Pull request and Notes tabs
whenever no workspace is chosen, plus a clean Changes tab, an empty file tree and
a project without a build or server script. Those tabs used to show one grey line
each, through four different wrappers. Each now says it in two parts: a short
title in a lighter voice, and the plain sentence saying what to do. In the
locales that is a pair of keys, `…Title` and `…Body`, so a new empty state adds
both — English first — and hands them to `Placeholder`, with `compact` in the
right column, rather than drawing a `<p>` of its own. `Notice` and the Scripts
tab's `Hint` stay for what is not emptiness: an error, a file the viewer cannot
show, a script waiting to be run. The line is
drawn at the pane: a picker's "Nothing found", a popover or a settings list
keeps its plain line, because a drawing has no room there and would read as a
broken image. The sidebar keeps its line too — with no projects, the centre is
already showing the octopus beside it. Like the centre, it tells the first two
cases apart: it asks for a repository only when there is none, and otherwise
points at the strip, because telling someone with three project tabs beside the
list to add a repository sends them the wrong way.

`compact` is the right column's variant: no panel around it, since the column is
already a panel of its own and a box inside it reads as a dialog nobody opened;
a smaller drawing; and it scrolls rather than clips, because the server half of
the Scripts tab is left with little height once the build half is unfolded.

**One octopus per tab.** The Scripts tab stacks a build half over a server half,
each with its own empty state, and two drawings one above the other read as a
rendering glitch — so the build half passes `art={false}` and the server half,
the one that is always unfolded, keeps it. The terminal's stays an overlay over
the sessions rather than a replacement for them, for the reason its own comment
gives: returning something else would unmount every terminal.

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

**Project settings says what Claude Code's own settings allow and refuse**,
beside the instruction sources and for the same reason: this is what the agent
picks up on its own, and until it was drawn the interface could not say it
existed. A rule in those files is honoured before octopus is consulted at all —
the SDK approves a matching call ahead of `canUseTool` — so a question that
stopped being asked had no explanation anywhere, and a refusal that stopped a
command had none either.

Measured, and it moved the feature: the note that asked for this expected the
rules in `.claude/settings.local.json`, and on a real checkout that file carries
none. The substantial lists — thirteen allows and four **denies** — are in the
committed `.claude/settings.json`, and the user's own file carries a
`defaultMode` and nothing else. So all three are read and every row names the
file it came from, which is where the change has to be made.

**Shown, never edited.** `.claude/settings.local.json` is one of the files the
worktree's trust digest is taken over — all of it, or all but its allow rules
when the carry list brought it — so writing to it could put the project back to
unapproved and empty the skill listing with it. A refusal is drawn
first and in the danger tone: a reader looking for why something will not run
needs it before a list of what will.

**The repository picker groups by owner**, the account's own repositories first
and then each organisation. Before organisations reached this dialog the list
was one flat run of names; with a work organisation in it the list is several
times longer, and its own name is the only thing anybody scans for. The order
comes from core, and the picker groups in the order it was handed — one question
with one answer rather than two that can drift.

It offers only repositories the account can **push to**. octopus works by
pushing a branch and opening a pull request from it, so a repository that can
only be read looks like a working choice right up until the first push fails.

**A list that is short says why, under itself.** Three ordinary things shorten
it without producing an error, and none used to leave a trace: the walk stopping
at its limit; a token without `read:org`, which makes GitHub answer as though
the account belonged to no organisation at all; and an organisation the account
does belong to that put nothing in the list. So a footnote below the rows names
whichever applies, and the scope one carries the command that grants it. Under
the list rather than over it, because it answers "why is my repository not
here" — a question the reader only has after looking.

**The third names the organisation and stops there.** A token that holds
`read:org` but has not been SSO-authorised for an organisation makes GitHub
answer as if that organisation did not exist — indistinguishable, locally, from
an organisation with nothing in it the account can push to. Nothing octopus can
read tells the two apart: `gh` relays no SAML signal, and both readings produce
the same short list.

So the line does not guess. It says which organisation is quiet and leaves the
cause to the reader, who knows which of the two theirs is and could act on
either — while the list simply looked complete. The earlier candidate was a
condition inferred from what is _absent_, and it fired identically for somebody
who belongs to no organisation at all: a cleverer way to be wrong.

The organisations come free. `viewer.organizations` is a sibling of `login` on
the same GraphQL `viewer`, so it rides in the request already being made, and it
is what turns "something may be missing" into a name. It says nothing while the
walk stopped at its ceiling — an organisation may have plenty beyond it, and
"none of its repositories are listed" is not a claim that survives a partial
list.

None of them hides anything: the repositories that _are_ listed are real, and
somebody adding one of them has no use for a dialog that refuses. And none is a
standing apology — each appears only when it is true, and being unable to tell
is a further case that says nothing. `gh` reports no scopes at all for a
fine-grained token, which can reach an organisation regardless, so reading
silence as "the scope is missing" would put a confident wrong sentence under a
list that is perfectly complete.

The same goes for a message that names somewhere else. "Check the account in
Settings" stood in the repository picker for a while with no way to reach
Settings, which leaves the reader to close the dialog and go hunting. If a
string names a place, something beside it should go there — and only when going
there would help: the picker offers it for an unreachable account and not for a
failed clone, because signing in again fixes one and not the other.

The mascot comes from `Mascot`, in two poses: the one holding a magnifying
glass stands in every empty pane — it is looking for something to show — and the
plain one signs off the About section in settings and is the app's icon. A component rather than a repeated `<img>` so the decision it carries
is made once: it is `alt=""` and `aria-hidden`, because wherever it appears the
words beside it already say what the screen is about, and announcing "blue
octopus" first would add a word and no information.

Both are drawn far smaller than their sources — the searching one is 360px
wide against at most 120 on screen, sized by height alone because it is wider
than it is tall and a square box would squeeze it — and scaled smoothly rather
than with `image-rendering: pixelated`. Nearest-neighbour at those ratios drops
pixels
unevenly and the blocks come out different sizes, which reads as a broken image
rather than as pixel art.
