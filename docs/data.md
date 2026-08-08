# Data on disk

Everything the application stores lives under `~/.octopus`. Paths are built in
one place — [`src/core/paths.ts`](../src/core/paths.ts) — so nothing anywhere
else joins a home directory by hand.

```
~/.octopus/
  config.json                        settings
  state.json                         projects and workspaces
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

| Field                             | Meaning                                                           |
| --------------------------------- | ----------------------------------------------------------------- |
| `version`                         | format version, for future migrations                             |
| `branchPrefix`                    | branches are `<prefix>/<workspace>`                               |
| `cloneDirectory`                  | where GitHub clones land; empty means "ask, then remember"        |
| `settingSources`                  | what the agent may load — `none` is the transparency default (§4) |
| `theme`, `language`               | appearance                                                        |
| `rightPanelWidth`, `sidebarWidth` | pane widths, in pixels                                            |
| `deviceId`, `installedAt`         | reserved for licensing (§15.3), unused                            |

**Every new field carries `.default()`.** Without one, adding a field rejects
every config written by an earlier build as malformed — which is what happened
when `language` was introduced.

## `state.json`

Validated by `StateSchema` in [`store.ts`](../src/core/store.ts).

A **project** is a repository that has been added: `id`, `name`, `repoPath`,
`baseBranch`, `branchPrefix`, `color`.

A **workspace** is a git worktree: `id`, `projectId`, `name`, `branch`, `path`,
`status`, `sessionId`, `port`, `createdAt`, `ownerId`.

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
