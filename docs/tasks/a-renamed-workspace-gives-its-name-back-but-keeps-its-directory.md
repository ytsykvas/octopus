# A renamed workspace gives its name back but keeps its directory

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`createWorkspace` builds its taken-name list from two sources only: the `name` of
each stored workspace of the project, and the suffixes of existing branches under
the project prefix. The directory, however, is `<root>/workspaces/<projectId>/<name>`,
fixed at creation and never moved. `renameWorkspace` changes the label and the
branch and nothing else.

So after a rename the original name is absent from **both** taken-name sources
while its directory is still on disk holding a live worktree, and
`nextWorkspaceName` can hand it back.

Two failures follow from the same draw:

- the directory is still there → `exists(path)` is true → `WorkspaceError('pathExists')`,
  naming a path under `~/.octopus/workspaces/` that means nothing to the reader;
- the directory has been removed by hand → `addWorktree` runs, and the failure
  lands later in `addWorkspace` as `StateConflictError('Workspace planner/ada already exists')`
  — because the rebuilt **id** is also the renamed workspace's id, a rename never
  changing it. That error carries no `code`, so the renderer has no localised
  message for it. `rollbackWorkspace` does undo the worktree, so nothing is left
  behind, but the user sees a raw English string.

Reproduced against the project's own fixtures with `random: () => 0`.

## Why it matters

Renaming a workspace to describe its task is the normal thing to do — the branch
is what shows up in the pull request, which is the stated point of the operation.
Every live renamed workspace permanently retires one name from the pool without
telling anybody.

`nextWorkspaceName` picks a random start index and walks forward to the first
free name, so with a 256-name pool and one orphaned name it is roughly 1 in 256
per press — which reads as a flaky app rather than a rule. It scales with the
number of live renamed workspaces, so a long-running project is where it becomes
visible.

**The secondary path is worse, because it never clears itself.** On the normal
path the name comes back when the workspace is removed. On the project-removal
path the directories outlive everything: the per-workspace `removeWorkspace` is
`.catch(() => undefined)`, and `removeProjectData` deletes only
`<root>/projects/<projectId>`. Nothing anywhere deletes
`<root>/workspaces/<projectId>` — `workspacesDir` has exactly one caller,
`workspacePath`, and no other reference in `src/`. Re-adding a repository that
resolves to the same project id inherits every one of them.

## Evidence

- `src/core/workspaces.ts:205-207` and `:212-215` — the only two taken-name
  sources; `fromState` maps `workspace.name`, which a rename has already changed.
- `src/core/workspaces.ts:219-225` — id, branch and path all recomputed from the
  freshly drawn name, then the `pathExists` throw.
- `src/core/workspaces.ts:130-132` — `workspaceId` is `${projectId}/${name}`, so
  the creation name is recoverable from `workspace.id`.
- `src/core/service.ts:2711-2713` — `renameWorkspaceById` commits only
  `{ name, branch }`.
- `src/core/store.ts:521-523` — the duplicate-id guard, throwing an uncoded
  `StateConflictError`.
- `src/renderer/src/hooks/useErrorMessage.ts:87-88` with `en.ts:1032` — the
  user-visible result is a bare "`<path>` already exists."
- `src/core/paths.ts:194` and `:204`; `src/core/projects.ts:221-237`;
  `src/core/service.ts:2646-2650` — the orphaned-directory half.
- `src/core/workspaces.test.ts:400-407` asserts the directory is intended to
  stay; nothing asserts the name stays claimed. The two `pathExists` tests
  (`:324`, `:351`) occupy the path artificially rather than through a rename.
- `docs/data.md:241-245` — the uniqueness table asserting workspace id is
  `<project>/<name>`, an invariant a rename silently breaks.

## What is already decided

**Moving the directory on rename is ruled out, twice and in writing**
(`workspaces.ts:190-192`, `docs/data.md:251-259`): `git worktree move` fails
whenever a dev server, terminal or editor is inside the worktree, which for this
app is the normal state. Do not reopen it.

## Sketch

The taken list needs a third source: each workspace's **creation** name. It is
available without touching the schema —
`workspace.id.slice(project.id.length + 1)` is exactly the directory name, and
generated names never contain `/`, so the slice is safe. `fromState` yields both
the id suffix and the current name.

That leaves the orphaned-directory half untouched: directories with no record at
all are invisible to `fromState` no matter what it reads. `removeProjectById`
already states the intent in its own comment — "left behind they are invisible to
the app but still occupy names, and adding the project back would collide with
its own debris" — and the code does not achieve it. Either `removeProjectById`
should `rm -rf` `workspacesDir(projectId, dataRoot)` after the commit, as it
already does for `projectDir`, or `createWorkspace` should read the directory
listing rather than only the store. The first is cheaper and matches the comment
already there.

**Do this together with `two-workspace-names-can-slug-to-the-same-database.md`.**
Both land in `nextWorkspaceName` and `renameWorkspace`, and both want the same
taken set widened — but they want different things from it: that one wants
slug-equality to refuse a rename, this one wants the pre-rename name kept in the
pool. They compose only if written as one pass over the project's workspaces
yielding the current name, its slug, and the creation name.
