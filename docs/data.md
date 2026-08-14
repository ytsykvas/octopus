# Data on disk

Everything the application stores lives under `~/.octopus`. Paths are built in
one place — [`src/core/paths.ts`](../src/core/paths.ts) — so nothing anywhere
else joins a home directory by hand.

```
~/.octopus/
  config.json                        settings
  state.json                         projects, workspaces and chats
  chats/<chatId>.jsonl               one conversation each, append-only
  projects/<projectId>/
    scripts/setup.sh                 runs in a new workspace
    scripts/run.sh                   starts the dev server
    instructions/pull-request.md     guidance for the agent
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

| Field                             | Meaning                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `version`                         | format version, for future migrations                              |
| `branchPrefix`                    | branches are `<prefix>/<workspace>`                                |
| `cloneDirectory`                  | where GitHub clones land; empty means "ask, then remember"         |
| `settingSources`                  | what the agent may load — `none` is the transparency default (§4)  |
| `workingMode`                     | what a new chat may do before asking; planning is not one of them  |
| `effort`                          | how much thinking a new chat asks for; `medium` unless changed     |
| `alwaysAllowedTools`              | tools the user answered "always" for, listed so they can be undone |
| `theme`, `language`               | appearance                                                         |
| `rightPanelWidth`, `sidebarWidth` | pane widths, in pixels                                             |
| `deviceId`, `installedAt`         | reserved for licensing (§15.3), unused                             |

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

## `state.json`

Validated by `StateSchema` in [`store.ts`](../src/core/store.ts).

A **project** is a repository that has been added: `id`, `name`, `repoPath`,
`baseBranch`, `branchPrefix`, `color`, `icon`.

A **workspace** is a git worktree: `id`, `projectId`, `name`, `branch`, `path`,
`status`, `port`, `createdAt`, `ownerId`.

`knownModels` is not a record of anything the user did: it is what the agent
last said this account may use, kept only so the model picker works before the
first message — the agent can be asked solely while a session is open. It is
replaced whole at the next session start, and it lives here rather than in
`config.json` because that file is written unqueued and would race the user's
own edits.

Each entry may carry a `resolvedModel` — the full name a short one stands for,
`sonnet` → `claude-sonnet-5`. Both names are in circulation and they arrive from
opposite directions: the picker stores whichever the catalogue offered, while a
running session reports itself in full. Matched by string alone the two read as
different models, and the picker would draw a second row for one already in it.

A **chat** is a conversation with one agent inside one workspace: `id`,
`workspaceId`, `agent`, `sessionId`, `model`, `effort`, `workingMode`,
`planMode`, `knownCommands`, `createdAt`.

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
record. The UI shows a single chat today; the store already allows more, and
`agent` is a one-member enum for the same reason.

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

The record is created from `config.workingMode` and `config.effort`, so those
are also what the composer shows until it exists — passed down from `App`,
which is where the config is read. The footer named the schema's defaults for a
while instead, which made it lie about exactly one message: the first.

Neither of those is ever null. `effort` was, meaning "leave it to the agent",
and the picker had a row saying so — a control naming a level the agent had
never been told about. It names `medium` now and `medium` is what goes.

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

Both are files rather than strings in the config: they outgrow a text field,
they are worth reading in a diff, and they can be run or edited outside the app —
which is the point of not owning the workflow (§4).

They live under the data root, **not in the repository**: a workspace is a
checkout of someone's project, not a place to leave ours.

Scripts are saved executable. Without the bit, running one fails with
"permission denied", which says nothing about what to do.
