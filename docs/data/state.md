# `state.json`

Validated by `StateSchema` in [`store.ts`](../../src/core/store.ts).

A **project** is a repository that has been added: `id`, `name`, `repoPath`,
`baseBranch`, `branchPrefix`, `color`, `icon`, and — beside the approvals below
— its own `disabledSkillDefaults`, which is the config field one layer down: it
answers for this project's conversations where the config answers for every
project's.

`baseBranch` is the branch the **user chose**, stored the way they chose it —
`main` or `origin/develop`, both are accepted. It is deliberately not the ref a
workspace is cut from: that is worked out at the moment of creation, because a
local name and its remote copy are the same point only until somebody else
pushes. Storing the resolved ref would freeze an answer that goes out of date on
the next fetch. `resolveBase` in [`remotes.ts`](../../src/core/remotes.ts) is where
the question is asked, every time it is asked.

A **workspace** is a git worktree: `id`, `projectId`, `name`, `branch`, `path`,
`status`, `port`, `createdAt`, `branchSince`, `writers`, `notes`, `ownerId`.

`branchSince` is when a rename brought the workspace onto its current branch, or
null for "since `createdAt`".

`notes` is a line the user wrote to themselves about this workspace, and the one
thing a workspace carries that the agent never reads. On the record rather than
in a file of its own so that removing the workspace takes it and renaming keeps
it, both without anybody arranging either — a file would have to be moved and
deleted by hand, and the day somebody forgot, a new workspace of the same name
would open holding a stranger's note. Bounded by `NOTES_LIMIT` for a reason that
is not about the note: `commit` rewrites this file **whole** on every call.

`writers` says which conversation wrote which file, by path relative to the
worktree. A workspace holds up to three conversations working at once in one
checkout and the changes pane shows their work as a single diff, so "the agent
changed this" stopped being one sentence when the second conversation arrived.

By **file** rather than by line, and that is the honest limit rather than a
first step: hunks come from a diff against the merge base, and every line after
an edit shifts as the next one lands, so a line number recorded now points
somewhere else by the time the pane draws it. A path does not move.

Stored rather than held in memory, because a workspace is open for days and an
in-memory record would attribute what was written since the app last started
while leaving the rest looking untouched — a review surface that is wrong costs
more than one that is silent. Written once at the end of a turn rather than per
edit: `commit` writes `state.json` whole, and an agent makes dozens of edits in
a turn.

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
`config.json` because that file holds settings the user can read and shorten,
and a cache the application writes for itself is not a setting.

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

`knownSkills` is the same kind of thing for the skills panel: each skill a
session described that our directories do not hold — `name`, `description` and
the SDK's `builtin` flag, as the agent said them. It exists
for one moment: a session leaves a skill it was told to withhold out of its
answer, so the switch that withheld one of Claude Code's own would otherwise be
the last anyone saw of it. **Merged by name rather than replaced**, the opposite
of `knownModels`, because the entries that matter are exactly the ones the
latest answer leaves out. Never pruned, and harmless for it: the panel draws a
remembered skill only while a conversation has it switched off, and draws one it
never heard of by name alone. Written only
when an answer says something new, since the panel asks on every open.

A **chat** is a conversation with one agent inside one workspace: `id`,
`workspaceId`, `agent`, `status`, `interrupted`, `sessionId`, `model`, `planModel`, `effort`,
`workingMode`, `planMode`, `autoCompactWindow`, `knownCommands`, `knownAgents`,
`skillOverrides`, `createdAt`, `closedAt`.

**`autoCompactWindow` is where the conversation compacts itself** — one of
`AUTO_COMPACT_WINDOWS` (300k to 800k), or null for the agent's own, which is the
default for a record written before the field existed. Null is sent as nothing
at all: the flag layer outranks the user's files, and a `/autocompact` saved
there is what null defers to. A fork carries it. The agent reads it only when a
session starts — measured, `applyFlagSettings` takes it and changes nothing — so
a change starts the conversation's session again with `resume`, at once when it
is idle and otherwise before the next message, the first moment nothing queued
can go with the old process.

**An agent event may name the call whose subagent produced it**
(`parentToolUseId`, on text, reasoning, tool calls and results): the SDK says
`null` for the conversation's own and that is stored as nothing, so a transcript
from before it reads the same as one after.

**A transcript's user entries carry a `uuid`**: the id the message was sent to
the agent under, which is what rewinding to it is asked with — the files' checkpoint
and the point the conversation is cut at both go by it. It is
optional — a message sent before ids were kept has none, and simply offers no
rewind. The `files_rewound` event records a rewind with how much it undid and how many
files a link kept it from restoring (`skippedLinks`, defaulting to 0). A
transcript is appended to, and the one rewrite is a conversation rewind, which
cuts it back to just before a user message; `conversation_rewound` is never
stored, since the history it would describe is already gone. Nor is
`message_queue`, which says a message is still in the agent's queue: read
back, every one of them was taken long ago.

**`resumeAt` is the cut a rewound conversation is waiting to apply**: the last
entry of the agent's session it should still remember, handed over as
`resumeSessionAt` when the next session starts, and cleared once a turn has run
there. It defaults to null — a record from before rewinding existed was never
rewound.

**`closedAt` is null while a conversation is a tab** and the time it was closed
otherwise. It defaults to null, so a record written before it existed loads as
open — the reader throws on a mismatch rather than falling back, and the app
would not open. A closed conversation keeps its record and its transcript until
the workspace goes or it is one of the oldest past
`MAX_CLOSED_CHATS_PER_WORKSPACE` (twenty).

**`model` and `planModel` are two models for two jobs**, and their nulls do not
mean the same thing. `model` null is the agent's own default. `planModel` null
is _no split at all_ — planning runs on whatever `model` says — which is what
keeps a conversation nobody has touched behaving exactly as it did before the
field existed.

The panels present the pair the other way round — the plan is the choice and
the writing may be `Same as plan` — without the stored shape changing: with no
split one value does both jobs, so which field carries it is only naming.
`JobPair` and its helpers in `chats.ts` are the one place that translates.

That leaves the plan side without a way to say "the agent's own default", since
its null is taken. It says it with the word: `DEFAULT_MODEL`, which is a row the
picker offers like any other. The asymmetry is forced rather than untidy, and
`sessionModel` in `chats.ts` is the only place allowed to unfold it — nothing
but its return value ever reaches the SDK, because a model literally called
`default` is not one.

**`skillOverrides` holds only what this conversation was told**, not the whole
answer. Whether a skill is on is that map over the project's
`disabledSkillDefaults` over the installation's, narrowest last. Storing the
resolved answer instead would freeze it: a skill added, renamed or removed after
the conversation started would be stuck at a copy of defaults that no longer
exist, and a conversation nobody has opened the panel in would carry a record of
every skill on the machine.

**And it is what the agent is told, not what the agent lists.** `skillOverridesFor`
in `skills.ts` turns every key the three layers mention into the session's
`skillOverrides`, `'on'` as well as `'off'`. It was built from the session's own
listing once, and a session leaves out what it withholds — so after a restart a
skill switched off was never withheld, and the next switch of anything else
handed it back. `'on'` is said out loud because leaving a key out does not undo
a withhold the session started with; measured against a live session.

**It is keyed by the bare name, whichever source the skill came from.** The keys
were once qualified — `octopus:review` for one of ours — on the theory that the
CLI resolves a qualified override first and falls back to the bare one, so a
bare key of ours would silence a repository skill sharing the name. Measured
against a live session it does not: a `local-probe` in the checkout and a
`local-probe` in our own store came back as **one row**, so they are one skill
as far as the CLI is concerned, and a key that told them apart would be
describing a distinction the agent does not have. `skillKey` in
[`skillNames.ts`](../../src/core/skillNames.ts) is the one place that says so, and
the consequence is worth knowing rather than discovering: switching either row
off switches both.

`knownCommands` is the same kind of thing as `knownModels` above, kept in a
different place for a reason worth stating: which models an account may use is a
fact about the **account**, while which slash commands exist is a fact about a
**worktree and the branch in it** — a project's own live in its
`.claude/commands/`, and two workspaces of one project sit on two branches.
Remembered globally, a command from one workspace would be suggested in another
that does not have it. The cost is that a fresh chat suggests nothing until its
first message has started a session. Each command carries `skill`, marked from
the session's `init` and defaulted to `false`, so a list remembered before the
field existed loads and offers nothing mid-sentence until the next session. `knownAgents`
is the `@` list, kept beside it for the same reason — a project's own agents
live in its `.claude/agents/` — and defaulted to empty for older records.

Custom commands only appear at all when `settingSources` includes `project`.
The setting is described as controlling `CLAUDE.md` and settings files, and it
turns out to gate `.claude/commands/` too — measured, not read off the types.
That measurement is why the default is now `all`: on `none` the list held only
the agent's own built-in commands, and the project's were simply absent.

The last two were one three-valued `permissionMode` until approving a plan had
to put the conversation back into a mode, and there was none to go back to —
planning had overwritten it. They are separate now, and the session's mode is
computed from both by `sessionMode` in `chats.ts`. No migration was written:
the schema is a plain object, so zod drops the key it no longer knows, and both
new fields default.

Four identifiers, and confusing them keeps causing bugs:

| Value              | Unique within                                                         |
| ------------------ | --------------------------------------------------------------------- |
| workspace `name`   | its project                                                           |
| workspace `slug`   | its project — it names a database, and is not injective               |
| workspace `branch` | its project — branches live in a repository                           |
| workspace `id`     | the whole application; it is the IPC key, `<project>/<creation name>` |

Two projects are two repositories, so `octopus/anna` in each is two different
branches. Treating that as a clash locked every project after the first out of
the start of the name pool.

**The id carries the name the workspace was created under**, not its current
one: a rename changes the label and the branch and never the id. That is what
makes the id the directory, and it is also the only record of the creation name
anywhere — which the pool needs, or it hands back a name whose folder still
holds a live worktree.

**The slug is the odd one, because it is deliberately not injective.**
`workspaceSlug` lowercases and turns every other character into `_`, so
`fix-login` and `fix_login` are one `myapp_development_fix_login`: the second
workspace's build loads a dump over the first's while its server runs, and the
first's cleanup drops a database the second is using. Nothing fails. Its rules
cannot be made unique — they mirror the `tr | sed | cut` pipelines in
repositories' own scripts, and that byte-compatibility is what lets an env block
and a shell script name one database — so `nextWorkspaceName` and the rename
refuse the collision instead.

## The workspace directory never moves

`id` fixes the directory when the workspace is created. Renaming changes the
label and the branch, and deliberately leaves the directory alone: `git worktree
move` fails whenever anything is running inside it — a dev server, an open
terminal, an editor. So a renamed workspace may live in `anna/` while its branch
is `ytsykvas/fix-auth`. The UI identifies a workspace by its branch, which is
what appears in a pull request.

## The chat owns the session, not the workspace

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

`interrupted` says the last turn was cut off by the application exiting rather
than brought to an end — `settleStatuses` sets it on a conversation it finds
`running` or `waiting_permission` at load. A flag beside `status` rather than a
fifth value in it, because the packaged app reads the same `state.json`: an
older reader throws on a status it does not know and drops a key it does not.
The cost is two fields for one state, held by an invariant: **true only while
`status` is `idle`**, set by `settleStatuses` alone and cleared by
`setChatStatus` on every move. Defaulted to false; a fork starts without it.

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
which is where the config is read.

The copy is not the end of it for the two models. A change of `config.model` or
`config.planModel` moves every chat that holds exactly the pair the settings held
just before — closed ones too — because a chat opened before the pair was saved
had no split, and an approved plan then had nothing to switch to. Equality with
the old settings stands in for "never chose its own", so no field says so; a chat
picked by hand to those very values follows as well, which is what that pair
already meant. The footer named the schema's defaults for a
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
