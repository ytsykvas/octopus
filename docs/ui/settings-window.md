# Settings, plugins and what a repository may run

**The rail ends in a tile of its own**: a puzzle piece the size of a project
tab, in a **foot** under the list rather than at the end of it. The list
scrolls, and a tile at its end would ride up and down with the number of
projects; the plugins are the agent's rather than a project's, so they sit
apart from the projects as well. It is tinted with the accent where the "+"
is drawn in the line colour — the "+" is an empty slot, this is a place — and
the piece turns a few degrees under the pointer, the one motion on the rail,
gone under `prefers-reduced-motion`. A ring says the window is open. An amber
dot in the project dot's place says an installed plugin would not load, which
is why `usePlugins` reads the installed list when the app starts rather than
when the window opens.

**`PluginsWindow`** is a `Modal` of the large size with two tabs, styled as the
import dialogs' pills:

- **Installed** — every scope, a project's own installs included and labelled
  with their project. A switch and a removal on each row; the removal asks
  first, because the plugin's data goes with it. A row octopus cannot change
  (`managed`) is shown with words — "On", "Off" — rather than a switch nobody
  can move, which would read as "not now" where the truth is "not here".
- **Store** — read the first time the tab is shown, since the listing takes a
  second or two, with outlined cards meanwhile. A search over name, description
  and keywords, a row of category pills (largest first, the uncategorised last
  as "Other"), and cards ordered by installs: the official catalog runs to some
  three hundred plugins, and the first screen of an alphabetical one is
  whatever starts with a digit. A card opens its details — the whole
  description, keywords, the homepage, and a note that a plugin runs with
  Claude Code's own access. An empty store with no official marketplace says
  why and offers to connect it, and a catalog that could not be read offers to
  read it again — the refresh button needs the marketplace connected to update it,
  and pulsing cards for ever would hide the way out. The store is the official
  marketplace only; the installed list still shows a plugin from anywhere, so
  one installed from a terminal can be switched off or removed here.

A plugin whose marketplace installs it by **running a command** comes back
from the first install as `needsConsent`. The store shows that command whole
in a confirmation and installs with its digest only on a yes.

**Every change says how far it reached**: the line under the tabs reads
"Applied to 3 open conversations" from the count core returns, or "Conversations
started from now on will load it" when none was open — so a switch that
worked is seen to have worked. A failure takes the same line, an action's over a
read's, and the line is cleared each time the window opens: the last visit's
count is not news. Each list read claims a number before its await and draws
only if it is still the newest, since two switches re-read the list twice at
once.

**When Settings → Agent leaves the user's settings out**, a plugin installed for
every project is installed and loads nowhere here, because that is the layer
that switches it on. The window says so above the tabs and links to the
setting, rather than letting every switch look broken.

A homepage is linked only when it is `https:` — a marketplace writes it, and
`shell.openExternal` will start any scheme the system knows. A plugin's tile is
its initials on a colour that follows from its id (`colorFor`), built as a
project tab is, so it reads as one of the family.

## What a repository is allowed to run

**The Scripts tab shows the panel when there is something to read.** A checkout
supplying its own scripts has them listed there — each under the file it came
from — with every byte of what would run, and `Run` disabled until it is
allowed. This is where it belongs because it is the answer
to "why is Run doing nothing", and that question is asked in front of `Run`.

After it is allowed the panel goes quiet, and the place to look is **Project
settings → Repository**, under **Trust**: one switch, _Trust this repository_,
then the two things it covers — the scripts the checkout supplies, and the Claude
settings, hooks and MCP servers it ships — each listed with where it came from,
whether it is allowed, and a _Review and allow_ that shows every byte first. One
question — how much of this checkout the app believes — in one place, rather
than a switch for scripts here and nothing but a banner in the chat for the rest.
The chat's banner and the Scripts tab's panel stay where the question is asked;
this is where it is answered for good.

**Every script, instruction, live field and the carry list says where it comes
from.** It used to be plain editors: with a repository script present, editing
Build saved happily and changed nothing that runs, and a repository's
pull-request instruction overrode the text somebody was editing without a word.
A box that takes an edit it will not honour is worse than no box. Now each one
has, under its name — which comes first, because under the tabs it read as the
end of the editor above and the switch looked like that one's:

- **a badge** — _In effect: Repository / This project / Settings / Template_, or
  _Nothing runs_ for a script nobody wrote;
- **a tab per layer that exists** (`LayeredEditor`, over the shared
  `Segmented`), opening on the one in effect. _This project_ is always there and
  is the one edited; the others are shown read-only with the file they live in,
  because that is where they are changed. The template says what it is — where
  an editor starts, and for a script nothing runs from it;
- **a switch, _Use mine instead of the repository's_**, wherever the repository
  supplies one. It writes `preferLocal` and reads the sources again.

The base branch and env file get the same as a line under their fields
(`FieldSource`): what the repository sets, which value applies, and — when the
repository's was refused — why, in words: not trusted yet, no such branch, a
file git would commit.

The carry list (Files) is a `LayeredEditor` too, with the differences a merge
makes: the repository's list is **added to** the project's rather than
replacing it, so the editor opens on _This project_ — in effect either way, and
the one edited — and its repository tab and switch say "added to" where the rest
say "instead of" (chosen from `view.id`, as the script template's line is).
_In effect: Repository_ there means the repository's lines are being added. Its
lines wait for trust like the env file's, and the editor says so in the same
words `FieldSource` uses (`SOURCE_WARNINGS`).

**Project settings → Repository opens on the trust switch** — the warnings under
Git, Env and Scripts send people there to turn it on — **and then the overview**
(`SourceTable`): a row per setting, a column per layer, a hollow dot where a
layer has something and a filled one where it is in effect, the switch in the
last column, and each row's name a link into the section that edits it. One read (`useProjectSources`) feeds
the table, the badges and the tabs, so they cannot disagree.

Settings → Instructions stays a plain editor per instruction: there is only the
installation's own and the template it starts from, and its hint says what can
override it.

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

**One row's answer depends on which directory the section asked about.**
`.claude/settings.local.json` is gitignored by Claude Code's own convention, so
seeing it in the **checkout** says nothing about the worktree a session runs in
— there it arrives only by being carried, and the carry list is the evidence:
the one a worktree would get, the repository's lines included.
Seeing it in the **worktree** is the whole fact: the session is started in that
directory and the SDK reads what is in it. Since the section asks about the open
workspace, the carry-list rule ran against a directory it was never written for,
and a file the workspace genuinely held was reported unread. That file is in the
trust digest — the user is asked to approve it precisely because it can
pre-approve tools and declare hooks — so the panel was wrong about a security
state in the reassuring direction, which is the same defect the workspace
question fixed everywhere else.

**Skills sit in both dialogs, and the section is one component.** The two
differ only in reach — every project, or this one — which is what the store
prop says, so writing them separately would have been two copies of a list that
drift apart the first time either is touched. The switch on each row is about
what a **new** conversation starts with; the panel in the composer is about the
one in hand, and the two are deliberately different questions in different
places. The project section additionally lists what the checkout carries, and
those rows draw the line in the one place it actually falls: **the file is
read-only, the decision to load it is not.** Editing the file from here would be
the app writing inside somebody's checkout, so Copy is all that is offered for
it — but whether the agent may reach for it is octopus's own record, so the same
switch sits on these rows as on ours, and turning one off writes nothing into
the repository.

Without it the page was empty of controls in the ordinary case: most projects
keep no skills of their own, so the two the agent would actually load were the
two with nothing beside them. Nothing in core had to change for it — the
map `skillOverridesFor` builds from the record already covers all three
scopes, keyed by the bare name.

**Commands and subagents get a section of their own, in both dialogs, holding
both kinds.** They live in the same two stores as the skills and reach a session
by the same roots, so the reasoning above about reach applies unchanged. What
makes them a separate pane is what is missing from the rows: **no switch.** A
skill can be turned off for one conversation because the SDK takes an override
for it; neither of these has one, so a command or a subagent is present or it is
not, and a control that looked like a choice would be a control that did
nothing. A list answering a different question belongs beside the skills, not
inside them.

**A new command reaches a running conversation; a new subagent does not.**
Measured against a live session, twice: with a store handed over as an additional
root, a command and a subagent written **before** the session started were both
listed, and one written **after** it appeared in `supportedCommands()` only once
`reloadSkills()` had been called — while the subagent written at the same moment
was still missing from `supportedAgents()` after the same reload. The SDK half
says as much: the SessionStart flag is documented as re-scanning "skill and
command directories", and nothing anywhere names `.claude/agents/`.

So the reload call after every write earns its keep for commands, and the
subagent sections carry a sentence saying a new one reaches the conversations
started after it. Written where it is true rather than left to be discovered
when the agent does not use one.

A command is drawn as `/name`, because that is what the reader types; a subagent
by its bare name, because it is never typed at all. The editor is **one field**
rather than the form-and-raw pair a skill gets: a command _is_ its text, and a
subagent's `tools` and `model` are fields a two-field form could only drop —
which is the quiet loss the skill editor's raw half exists to prevent.

**The import asks for a name, where a skill's import never does.** A skill names
itself in its frontmatter and a second name would file it under something the
document does not say; a command names itself nowhere, so somebody has to
choose. That is what the read step is for here — it is not a courtesy for the
link route, it is how the name gets on screen before it is decided. What the
source suggests is prefilled: a subagent's own `name`, a file's own name tidied
(`Run Checks.md` becomes `run-checks`), and nothing at all for pasted text.

**About lists the terminals still running, with a way to end one.** A
pseudo-terminal outlives the pane that started it more easily than it looks — a
window closed, a document reloaded, a half unmounted without its cleanup — and
what that costs is not tidiness: a shell stays alive, a port stays held, and a
dev server goes on writing to a file nobody reads. The symptom reaches the user
from somebody else's tool, as "a server is already running".

Every window's sessions rather than the open one's, which is the whole point:
the session worth finding is precisely the one whose pane is gone. Each row says
what it is and whose it is, from an `owner` the **renderer** chooses — `main`
sees a working directory and an argv and cannot tell a dev server from a shell
tab. Read once when the section opens rather than watched, because nothing
announces a session starting and a row that quietly went stale would be worse
than one the reader knows is a snapshot.

**About says how much the pasted images weigh, with a way to empty them.** It is
the one place octopus quietly uses disk: nothing removes a pasted image on its
own, and nothing should — a path in a sent message is a promise the file is
there, and a transcript is read back weeks later. A reaper on start-up would
break an old conversation to tidy a folder nobody was looking at, so the answer
is to make the folder **visible** and leave the decision where it belongs, which
is the shape the trust digest and the skill stores already use. The row is not
drawn at all until the measurement comes back — one that said "0 images" and
then corrected itself to twelve would be worse than one that appears once — and
emptying asks first, saying plainly that an old message will then point at a
file that is gone.

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
