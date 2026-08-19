# Data on disk

Everything the application stores lives under `~/.octopus`. Paths are built in
one place — [`src/core/paths.ts`](../src/core/paths.ts) — so nothing anywhere
else joins a home directory by hand.

```
~/.octopus/
  config.json                        settings
  state.json                         projects, workspaces and chats
  chats/<chatId>.jsonl               one conversation each, append-only
  instructions/pull-request.md       guidance every project falls back to
  projects/<projectId>/
    carry                            paths carried from the checkout into a workspace
    env                              variables written last into every workspace's .env
    scripts/setup.sh                 prepares a new workspace, on Run
    scripts/run.sh                   starts the dev server
    scripts/archive.sh               takes back what setup gave out, on removal
    instructions/pull-request.md     this project's own, which wins
  workspaces/<projectId>/<name>/     the git worktrees
```

## What is stored, and what is not

**git is the source of truth about git.** Branches, worktrees and changes are
never mirrored into `state.json` — they are read from git when needed. The file
holds only what git cannot know: the agent session, the port, the label.

This is why `reconcile` in [`workspaces.ts`](../src/core/workspaces.ts) exists.
It compares stored records against `git worktree list` and marks anything git
no longer backs as **missing**, rather than dropping the record or trusting it.
A silent disagreement between the two is precisely the class of bug the layout
is meant to avoid.

One subtlety that cost a bug: deleting a worktree directory by hand does not
remove git's record of it. The entry stays, flagged `prunable`, so comparing
paths alone reported such a workspace as healthy. The parser reads the flag now.

## `config.json`

Validated by `ConfigSchema` in [`config.ts`](../src/core/config.ts).

| Field                             | Meaning                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version`                         | format version, for future migrations                                                                                                                              |
| `branchPrefix`                    | branches are `<prefix>/<workspace>`                                                                                                                                |
| `cloneDirectory`                  | where GitHub clones land; empty means "ask, then remember"                                                                                                         |
| `settingSources`                  | what the agent may load — `none` is the transparency default (§4)                                                                                                  |
| `workingMode`                     | what a new chat may do before asking; planning is not one of them                                                                                                  |
| `effort`                          | how much thinking a new chat asks for; `medium` unless changed. Five levels, never `ultracode` — see below                                                         |
| `model`, `planModel`              | the pair a new chat starts on — which model writes the code, which one plans                                                                                       |
| `alwaysAllowedTools`              | tools the user answered "always" for, listed so they can be undone                                                                                                 |
| `theme`, `language`               | appearance                                                                                                                                                         |
| `rightPanelWidth`, `sidebarWidth` | pane widths in pixels, as last dragged — resizing the **window** moves the right pane without rewriting this                                                       |
| `diffView`                        | whether a diff is drawn in one column or two — a preference about how code is read, not a per-session mood                                                         |
| `rightPanelTab`                   | which of the right pane's tabs is showing; whether the pane is folded away is **not** stored — `build` and `server` are still read and become `scripts`, see below |
| `deviceId`, `installedAt`         | reserved for licensing (§15.3), unused                                                                                                                             |

`alwaysAllowedTools` is filtered on the way in **and on the way out**, and never
holds `ExitPlanMode`. An entry there is not merely a pre-answered question — it
stops the question being asked at all. With the plan tool in it the agent's plan
was approved before anything was drawn: no dialog, no record that planning had
ended, and the toggle still lit over an agent editing files. It went unnoticed
for a day. `NEVER_STANDING` in `config.ts` is what strips it.

The list is **not** passed to the SDK. It was, alongside the read-only tools,
and that made it unrevokable: a name the SDK holds is approved before
`canUseTool` is consulted, so unticking a tool in Settings reached only the
sessions that had not started yet, while the one on screen kept running the
tool. `askPermission` consults the list itself now, on every call, against the
config as it stands at that moment.

**Every new field carries `.default()`** — here, in `StateSchema` and in
`ChatSchema` alike. `readJsonFile` throws on a mismatch rather than falling
back, so a field without one does not lose the value: it stops the application
opening until someone edits JSON by hand. This is what happened when `language`
was introduced.

**A field that is _present and null_ is a different problem**, and a default
does not answer it — a default is for a key that is not there at all. `effort`
holds the case: it was nullable while "the agent decides" was a choice the
picker offered, and records on disk still say so. `StoredEffortSchema` in
`chats.ts` normalises it with a `transform`, which runs on the way in **and** on
the way out, since `persist.ts` writes back what the schema returned — so the
old null is cleaned off the disk the next time anything is saved. Same shape as
the `alwaysAllowedTools` filtering above. A `.catch()` would cover both cases in
fewer characters and is deliberately not used: it would also swallow a genuinely
corrupt value, which is the one thing this reader exists to shout about.

## One process owns this directory

Writes to `state.json` are serialised — `commit` in
[`service.ts`](../src/core/service.ts) chains them — and each one is written to a
temp file and renamed, so a crash cannot leave a truncated file behind. Both are
about **one** process. Neither is exclusive.

Two copies of the app open the same file, hold it in memory and write it whole,
so the last writer wins: what the other window did is not merged and not
refused, just absent the next time it saves. That was observed rather than
feared — one window created a workspace while the other still held one it had
removed, and removing that stale record then failed on a worktree already gone.
Losing a record is worse than failing to write one, because the worktree and the
branch survive on disk, invisible to the app that made them.

So `src/main/index.ts` takes Electron's single-instance lock before the app is
ready. A second launch quits and brings the window already open forward, and
never builds a service at all. The lock is keyed on Electron's userData
directory rather than on `~/.octopus`, so a build whose userData differs is not
covered by it — the residue is written down in `docs/tasks/`.

Editing these files from outside while the app runs is the same hazard reached
another way: the app keeps its own copy in memory and will happily write over
anything changed underneath it.

## `state.json`

Validated by `StateSchema` in [`store.ts`](../src/core/store.ts).

A **project** is a repository that has been added: `id`, `name`, `repoPath`,
`baseBranch`, `branchPrefix`, `color`, `icon`.

A **workspace** is a git worktree: `id`, `projectId`, `name`, `branch`, `path`,
`status`, `port`, `createdAt`, `ownerId`.

`port` is **allocated, not derived**. It used to be a hash of the id, so it
survived a restart and a bookmark kept working — but the hash asked only our own
records whether a port was free, and one another application was holding got
handed out anyway. Now it is the lowest block of ten in the pool that no
workspace holds and nothing answers on, and it can change: a run whose port has
been taken since moves to a free block. A bookmark can therefore go stale, which
is a smaller cost than a server that cannot start.

`status` is `idle`, `running`, `waiting_permission` or `error`, and
the workspace list draws it — which is how work in a workspace nobody is looking
at becomes visible at all. It is **settled on load**: `running` and
`waiting_permission` describe a session, and no session survives the process
that held it, so a workspace left mid-turn when the app quit would otherwise
come back claiming to be working with nothing behind the claim. `error` stays,
being a record rather than a session.

`knownModels` is not a record of anything the user did: it is what the agent
last said this account may use, kept only so the model picker works before the
first message — the agent can be asked solely while a session is open. It is
replaced whole at the next session start, and it lives here rather than in
`config.json` because that file is written unqueued and would race the user's
own edits.

Each entry **may** carry a `resolvedModel` — the full name a short one stands
for, `sonnet` → `claude-sonnet-5`. Both names are in circulation and they arrive
from opposite directions: the picker stores whichever the catalogue offered,
while a running session reports itself in full. Matched by string alone the two
read as different models, and the picker would draw a second row for one already
in it.

**"May" is doing real work there.** The field is optional in the SDK's own type,
and the CLI in hand fills it in for no row at all — every entry arrives with it
null. Anything reading it has to have an answer for that, and code written
against the type alone will look correct and do nothing: `defaultAgentModel`
was, and the picker quietly fell back to calling the default "Default model" on
an account with five models remembered.

What that CLI does send is the **description**, copied verbatim onto both rows,
because the default row is built from the row it points at. So `default` and
`opus[1m]` are word for word "Opus 5 with 1M context · Best for everyday,
complex tasks", and that is the link `defaultAgentModel` follows when nothing
resolves. Weaker than an id and enough: a wording that stopped matching would
cost the name, not correctness, since the caller has words to fall back on.

The fixtures for both shapes are in `chats.test.ts`, and the one for this
catalogue was copied out of a live `state.json` rather than written from the
type — which is the only reason the second shape is known to exist.

A **chat** is a conversation with one agent inside one workspace: `id`,
`workspaceId`, `agent`, `sessionId`, `model`, `planModel`, `effort`,
`workingMode`, `planMode`, `knownCommands`, `createdAt`.

**`model` and `planModel` are two models for two jobs**, and their nulls do not
mean the same thing. `model` null is the agent's own default. `planModel` null
is _no split at all_ — planning runs on whatever `model` says — which is what
keeps a conversation nobody has touched behaving exactly as it did before the
field existed.

That leaves the plan side without a way to say "the agent's own default", since
its null is taken. It says it with the word: `DEFAULT_MODEL`, which is a row the
picker offers like any other. The asymmetry is forced rather than untidy, and
`sessionModel` in `chats.ts` is the only place allowed to unfold it — nothing
but its return value ever reaches the SDK, because a model literally called
`default` is not one.

`knownCommands` is the same kind of thing as `knownModels` above, kept in a
different place for a reason worth stating: which models an account may use is a
fact about the **account**, while which slash commands exist is a fact about a
**worktree and the branch in it** — a project's own live in its
`.claude/commands/`, and two workspaces of one project sit on two branches.
Remembered globally, a command from one workspace would be suggested in another
that does not have it. The cost is that a fresh chat suggests nothing until its
first message has started a session.

Custom commands only appear at all when `settingSources` includes `project`.
The setting is described as controlling `CLAUDE.md` and settings files, and it
turns out to gate `.claude/commands/` too — measured, not read off the types. On
the default (`none`) the list holds only the agent's own built-in commands.

The last two were one three-valued `permissionMode` until approving a plan had
to put the conversation back into a mode, and there was none to go back to —
planning had overwritten it. They are separate now, and the session's mode is
computed from both by `sessionMode` in `chats.ts`. No migration was written:
the schema is a plain object, so zod drops the key it no longer knows, and both
new fields default.

Three identifiers, and confusing them has caused three separate bugs:

| Value              | Unique within                                                |
| ------------------ | ------------------------------------------------------------ |
| workspace `name`   | its project                                                  |
| workspace `branch` | its project — branches live in a repository                  |
| workspace `id`     | the whole application; it is the IPC key, `<project>/<name>` |

Two projects are two repositories, so `octopus/anna` in each is two different
branches. Treating that as a clash locked every project after the first out of
the start of the name pool.

### The workspace directory never moves

`id` fixes the directory when the workspace is created. Renaming changes the
label and the branch, and deliberately leaves the directory alone: `git worktree
move` fails whenever anything is running inside it — a dev server, an open
terminal, an editor. So a renamed workspace may live in `anna/` while its branch
is `ytsykvas/fix-auth`. The UI identifies a workspace by its branch, which is
what appears in a pull request.

### The chat owns the session, not the workspace

`sessionId` used to sit on the workspace. It moved because the shape decided
what the application could become: one session per workspace makes a second
agent in the same worktree a migration, while one per chat makes it another
record. That is how it played out — the interface now offers up to three
conversations per workspace, and the stored shape did not have to change for it.
`agent` is a one-member enum for the same reason, so a second _kind_ of agent
stays a widened enum rather than a migration.

Three because they share a worktree: past that the tabs stop being a way to work
in parallel and become a way to lose track of who changed what. The cap lives in
`chats.ts` as `MAX_CHATS_PER_WORKSPACE`, which is also where the tab strip reads
it from — the renderer may import _values_ only from core modules that pull in
nothing Node-only, and `store.ts` reaches `node:os` through `paths.ts`.

`status` sits on the chat as well, and the workspace's own is **derived** from
its conversations by `workspaceStatusFrom`: `waiting_permission` outranks
`running`, which outranks `error`, which outranks `idle`. Before this, whichever
conversation last had an event wrote the workspace's status, so the one that
finished reported the two still working as idle.

`title` is the name a user gave a conversation, and null for the one it is
given — `Claude 1`, from the chat's `agent` and its place in the strip. Null
rather than a copy of that name, and defaulted rather than migrated, for the
reason the project icon is: absent is already the right answer, and writing the
automatic name down would freeze it, so a conversation would keep the number it
had when it was opened after the tab beside it was closed. Clearing the field is
how the interface asks for the automatic name back, which is a value rather than
an absence.

A forked conversation carries the source's two models, effort, working mode and
known commands, and deliberately **not** its `planMode` or its `title`: planning is a
decision about a particular task, forking out of a settled plan to try the other
approach is the likeliest reason to fork at all, and two tabs bearing one name
is a strip that cannot be read.

A chat is created by the **first thing done to it**, not by the workspace: the
first message, or choosing a setting in the composer before sending one. A
workspace nobody has touched has no record and no transcript, so the state
describes what happened rather than what might.

Settings count because a choice has to be kept somewhere, and it belongs to the
conversation rather than to the application. The controls were in the header
until they moved into the composer, disabled until a record existed — which made
the mode of the first message the one mode nobody could pick. Opening is
idempotent and writes no transcript (only appending an entry does that), so the
record costs one row.

The record is created from `config.workingMode`, `config.effort`,
`config.model` and `config.planModel`, so those are also what the composer shows
until it exists — passed down from `App`,
which is where the config is read. The footer named the schema's defaults for a
while instead, which made it lie about exactly one message: the first.

Neither of those is ever null. `effort` was, meaning "leave it to the agent",
and the picker had a row saying so — a control naming a level the agent had
never been told about. It names `medium` now and `medium` is what goes.

**A chat's `effort` is one value wider than the settings' own.** The five levels
are what the SDK takes; `ultracode` is a sixth thing a conversation can be set
to and not a level at all — the SDK spells it as a flag beside `xhigh`. So
`ChatSchema` uses `StoredEffortChoiceSchema` and `ConfigSchema` keeps
`StoredEffortSchema`, and the difference is deliberate: a default is inherited by
every new conversation, and running a fleet of agents is a decision taken about
one task. `sessionEffort` in `chats.ts` folds the choice back into the pair the
SDK asks for.

Held as one field rather than as a level plus a boolean, because the two cannot
vary independently: `ultracode` with `low` is a state nothing can run and the
scale cannot draw. No state version bump — a new value in an existing enum needs
none.

**A stored tab that no longer exists still opens.** Build and server were two
tabs before they were one, and a config on disk names whichever was last used.
`.default()` answers for a key that is missing and says nothing about a key that
is present holding a word this build does not know — and `persist.ts` throws on
that rather than resetting, at startup, un-guarded. Left to a plain enum, every
existing install would have failed to start over a tab nobody chose.

So `StoredRightPanelTabSchema` accepts the two old names and folds them into the
one that replaced them, on the way in **and** on the way out — the stale word
leaves the disk the next time anything is saved. Same shape as
`StoredEffortSchema`, and the same reason.

### Transcripts

The SDK's `resume` restores what the _model_ remembers, which is not what the
screen has to draw. Without a record of our own a chat comes back empty after a
restart while its session is very much alive.

One JSONL file per chat, appended to as events arrive. Append-only because the
alternative is rewriting a growing document on every event — an hour-old chat
would spend most of its time serialising its own past. A line that does not
parse is skipped rather than thrown on: a crash mid-write leaves a truncated
last line, and losing the conversation over a partial byte is worse.

Streaming fragments are **not** stored. The finished block follows immediately
after, and keeping both would replay every answer twice on the next launch.

One kind of entry arrives **after** the one it describes. The lines around a
change are read from the file once the edit succeeds, and a file read is not
something the event handler can wait for without letting later events overtake
earlier ones — so `change_context` is written whenever the read returns, and
carries the `toolUseId` it belongs to. Whatever draws the log pairs them up by
that id rather than by position, and treats the entry as invisible where it
lands: it may fall in the middle of a run of later tool calls, and a break the
reader cannot see is worse than none.

The filename is the chat id, a uuid, and the directory is flat. A chat outlives
the name its workspace had when it started, so filing it under that name would
either strand the file on a rename or require moving it.

### What is deliberately not stored

The subscription's rate limit lives in the service's memory and never reaches
`state.json`. It describes the account at this moment and expires on its own, so
a reading restored from disk after a night is worse than none: it would be drawn
with full confidence and be wrong. It is re-learned from the first turn that runs.

The same goes for the two figures the composer's attic shows, which are pulled
from a running agent rather than pushed. **The context share is not kept at all**,
not even in memory: it describes a live child process, and once that process ends
the next one rebuilds a context we never observed. **The subscription windows are
cached beside the rate limit** — they belong to the account, so a workspace with
no session of its own can still show what another workspace's turn learned.

### Ports

`assignPort` derives a port from the workspace id — the same id always gives the
same port, so a restart does not reshuffle them — and walks forward on collision
until it finds a free one in 3000–9000.

## Migrations

`migrate` in `store.ts` runs on every load. It has done two things so far:

- **qualified bare workspace ids** with their project, from before ids carried
  one;
- **handed colours to projects that predate them.** A schema `.default()` was
  wrong here: it would have given every existing project the same colour, which
  is the opposite of what a colour is for. So `color` is optional in the schema
  and filled in during migration, each pick seeing what the previous ones took.

The distinction is worth remembering: a default is right for a field with one
sensible value, and wrong for one whose whole purpose is to differ.

`icon` is the other side of it and got **no** migration: a project nobody has
picked a picture for falls back to its initials, so "absent" is already the right
answer and handing out icons the way colours were handed out would be inventing
choices for people. The field is optional on disk and nullable in a patch —
`null` is how the dialog says "back to the initials", which is a value rather
than an absence, and telling the two apart is what makes the choice reversible.

## Atomic writes

`persist.ts` writes to a temporary file and renames it. A rename is atomic on
the same filesystem, so a crash mid-write leaves either the old file or the new
one — never half of either.

Reading validates with zod and **fails loudly** on a corrupt file rather than
falling back to defaults. Silently resetting someone's projects because a byte
went wrong is worse than refusing to start.

## Scripts and instructions

**Instructions come at two levels.** `instructions/pull-request.md` under the
data root is the installation's own; the same file under a project's directory
is that project's, and it wins where it exists. `effectiveInstruction` in
`instructions.ts` is the one place that order is written down.

An **empty** project file counts as an answer. Emptying it says this project
adds nothing, and falling through to the global one there would make that
impossible to express — so the chain asks whether a file exists, not whether it
has text in it.

Both are files rather than strings in the config: they outgrow a text field,
they are worth reading in a diff, and they can be run or edited outside the app —
which is the point of not owning the workflow (§4).

They live under the data root, **not in the repository**: a workspace is a
checkout of someone's project, not a place to leave ours.

There are three of them now, and the third runs on the way out. `archive.sh`
is given the same environment as the others and the workspace as its working
directory, so it can drop a database named after it — and **it cannot stop the
removal**. A failure, a hang, a script that was never written: all end with the
workspace gone. A workspace that cannot be deleted because a cleanup script is
broken is a worse problem than the one being cleaned up.

Scripts are saved executable. Without the bit, running one fails with
"permission denied", which says nothing about what to do.

## Files carried into a workspace

`projects/<projectId>/carry` holds one path per line, relative to the project's
checkout. `carry.ts` copies each into a new workspace at creation, and again
before a run so a workspace that predates a list entry picks it up.

**A list of paths, not the contents.** Keeping contents here would be a copy
that goes stale, and it did: a `.env` snapshot taken while it pointed at
production kept pointing there long after the checkout had moved on. The
checkout is the source; the list only says which parts of it travel.

It **never overwrites** — `COPYFILE_EXCL`, so a file edited inside the worktree
survives and there is no window between a check and a write. A path the checkout
does not have is passed over rather than failed on: a list is written once and a
project's needs change.

Anything absolute, or reaching outside the checkout with `..`, is dropped rather
than refused. The list is typed by hand, and one bad line should not stop the
rest of a workspace being prepared.

## Env overrides typed against a project

`projects/<projectId>/env` holds variables typed in project settings, mode
`0o600` because they are credentials. They are written into each workspace's
`.env` — appended, between two markers:

```
…everything carried from the checkout…

# >>> octopus: project overrides
MYSQL_HOST=dev.example
# <<< octopus
```

**At the end, because last wins.** `dotenv` and every implementation of it keeps
the final definition of a name, so the block overrides whatever the copied file
held. That matters twice.

The first is a project **cloned from GitHub**, where the carry list answers
nothing: a fresh clone has no `.env` and no `config/master.key` by definition —
they are gitignored, so GitHub never had them. There is nothing to copy, and the
first sign of it is the framework complaining about credentials. Here the block
is not an override at all; it is the file, created holding only itself.

The second is a checkout pointing somewhere it should not. A `.env` left on the
production block hands every workspace production, quietly, and the block puts
that right without editing anyone's file.

**Two markers rather than one**, so a rewrite replaces only what we wrote. With
a single opening marker the tidiest implementation is to truncate there — and
that eats any line somebody added inside the workspace afterwards. An opening
marker with no closing one means the file was edited into a shape we did not
write; everything from it on is replaced, since keeping half a block is worse.

Emptying the overrides removes the block and leaves the rest of the file alone.

**Appended, and nothing else.** These do not reach the process environment: the
terminal and the agent see them only through whatever loads `.env` from the
workspace directory. `bin/rails console` will; a bare `psql` in the Terminal tab
will not, because nothing exported them into the shell. That is the price of
appending, and it is the right price — appending is what works when the app
reads `.env` and the process environment does not reach it.

Files and variables are put in place together, at creation and again before a
run, so a workspace that predates either picks it up. The files go first: the
block has to end up below whatever was copied, which is the whole reason it
wins.
