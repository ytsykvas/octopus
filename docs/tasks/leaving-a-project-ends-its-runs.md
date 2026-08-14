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

- `src/renderer/src/components/RightPanel.tsx` — `scriptable`, and the comment
  above it explaining why the filter is there.
- `src/renderer/src/App.tsx` — `scriptPaths` is read for `selectedProjectId`
  alone, which is what makes the filter necessary.

## What is already decided

The filter is not the problem and must not simply be dropped. A runner holds the
**open** project's `setup.sh`, so one left standing from another project would
offer to run this project's script in a directory that never asked for it — and
`ScriptRunner` ends a run the moment its `scriptPath` goes null, so handing it a
null while it runs kills it just as surely.

## Sketch

Give the pane a script path per project rather than one pair for the open one:
`App` reads `projects.scriptPaths` for each project instead of for the selected
one, and `WorkspaceScripts` takes the pair belonging to each workspace's own
project. The filter then disappears, because every runner has paths that are
genuinely its own.

Worth checking first how many projects a read costs — it is one IPC call each,
made where a single call is made today, and it happens on every project change.
