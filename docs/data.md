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
| `permissionMode`                  | what a new chat may do before asking                               |
| `alwaysAllowedTools`              | tools the user answered "always" for, listed so they can be undone |
| `theme`, `language`               | appearance                                                         |
| `rightPanelWidth`, `sidebarWidth` | pane widths, in pixels                                             |
| `deviceId`, `installedAt`         | reserved for licensing (§15.3), unused                             |

**Every new field carries `.default()`.** Without one, adding a field rejects
every config written by an earlier build as malformed — which is what happened
when `language` was introduced.

## `state.json`

Validated by `StateSchema` in [`store.ts`](../src/core/store.ts).

A **project** is a repository that has been added: `id`, `name`, `repoPath`,
`baseBranch`, `branchPrefix`, `color`, `icon`.

A **workspace** is a git worktree: `id`, `projectId`, `name`, `branch`, `path`,
`status`, `port`, `createdAt`, `ownerId`.

A **chat** is a conversation with one agent inside one workspace: `id`,
`workspaceId`, `agent`, `sessionId`, `model`, `permissionMode`, `createdAt`.

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

A chat is created by the **first message**, not by the workspace. A workspace
nobody has spoken to has no record and no transcript, so the state describes
what happened rather than what might.

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

The filename is the chat id, a uuid, and the directory is flat. A chat outlives
the name its workspace had when it started, so filing it under that name would
either strand the file on a rename or require moving it.

### What is deliberately not stored

The subscription's rate limit lives in the service's memory and never reaches
`state.json`. It describes the account at this moment and expires on its own, so
a reading restored from disk after a night is worse than none: it would be drawn
with full confidence and be wrong. It is re-learned from the first turn that runs.

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
