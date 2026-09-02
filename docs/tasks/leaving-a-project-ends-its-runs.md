# Leaving a project ends its runs

**Found:** 2026-08-15, while making a run outlive the workspace switch.

## What happens

`WorkspaceScripts` is given only the workspaces of the open project, so opening
another project unmounts every runner of the previous one — and unmounting is
how a run ends. A dev server started in a workspace of project A dies the moment
project B is opened.

Within a project the runs now survive; across projects they do not.

## Why it matters

Less often than the workspace switch it replaces, but the same loss: the server
was started to be running while you work, and working sometimes means the other
repository.

## Evidence

- `src/renderer/src/components/RightPanel.tsx:432-442` — `scriptable`, and the
  comment above it explaining why the filter is there. The reason it gives is
  the stale one below, and is corrected along with the filter.
- `src/renderer/src/App.tsx:757-758` and `:796` — `defaultBranch`,
  `defaultEnvProfile` and `rootPath` are read off `selectedProject` alone and
  handed to the pane as one set for every runner, which is what makes the
  filter necessary.
- `src/renderer/src/hooks/useWorkspaceScripts.ts:49-51` — the scripts, by
  contrast, are already one answer per workspace.

## What is already decided

The filter is not the problem and must not simply be dropped. The scripts are no
longer what holds it in place: they are resolved in the worktree that supplies
them, so a runner left standing already keeps its own. What is still the **open**
project's is everything around them — `rootPath` reaches every runner as
`$OCTOPUS_ROOT_PATH` and `defaultBranch` as `CONDUCTOR_DEFAULT_BRANCH`
(`ScriptRunner.tsx:400-411`), and `defaultEnvProfile` is what the pane calls a
workspace's env set when it has none of its own. A runner from another project
would therefore build against a checkout and a base branch that are not its own
— and `ScriptRunner` ends a run the moment its `script` goes null
(`ScriptRunner.tsx:88`), so handing it a null while it runs kills it just as
surely.

## Sketch

Give the pane those three values per workspace rather than one set for the open
project: `RightPanel` takes the `rootPath`, `defaultBranch` and
`defaultEnvProfile` of each workspace's own project instead of
`selectedProject`'s. The filter then disappears, because every runner has the
values that are genuinely its own.

Nothing new is read for it. The scripts already cost one IPC call per workspace
on every list change, and the three values sit on the project records `App`
holds in memory.
