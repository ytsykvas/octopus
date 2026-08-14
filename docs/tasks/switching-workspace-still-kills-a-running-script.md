# Switching workspace still kills a running script

**Found:** 2026-08-15, while stopping a tab switch from killing one.

## What happens

`ScriptRunner` is keyed by the active workspace, so clicking another workspace
remounts it. Remounting unmounts `Terminal`, and unmounting `Terminal` is
exactly how the Stop button ends a run — the same mechanism that made switching
tab kill a dev server, reached by a different click.

Start the server in one workspace, look at another, and it is gone.

## Why it matters

Several workspaces serving at once is not an accident of the design, it is the
design: `run.sh` is handed `OCTOPUS_PORT` precisely so they can, and the prop
that carries it says so — _"passed to `run.sh` so several workspaces can serve
at once"_. Today the port is unique and the server is not, so the reason for
the port never arrives.

It is also the last third of a bug already fixed twice in the same file. The
comment above the terminals states the rule outright: a session belongs to the
workspace, not to what happens to be on screen.

## Evidence

- `src/renderer/src/components/RightPanel.tsx` — `key={`server-${activeWorkspaceId ?? 'none'}`}`
  and the same for `build`.
- `src/renderer/src/components/ScriptRunner.tsx` — the Stop button, whose whole
  implementation is ceasing to render `Terminal`.
- `src/renderer/src/components/WorkspaceTerminals.tsx` — the shape this wants,
  already written: one instance per workspace visited, hidden rather than
  unmounted, and dropped only when the workspace itself goes.

## What is already decided

A run must not appear to belong to another workspace — that is what the key was
protecting, and it stays protected. The question is only whether the run is
**kept** rather than killed.

Cheaper here than it was for terminals: an unstarted runner holds nothing at
all, so mounting one per workspace costs a line of text until its Run button is
pressed.

## Sketch

A `WorkspaceScripts` beside `WorkspaceTerminals`, holding a runner per workspace
visited for each of the two kinds, hidden with `invisible` rather than
`display: none` so `FitAddon` keeps measuring a real box. It needs each
workspace's own `port`, which the `workspaces` list already carries, and the
project's script paths, which are the same for all of them.

Worth settling first: whether a workspace whose worktree has gone should take
its running server with it. `WorkspaceTerminals` already drops missing
workspaces for that reason, and the same argument applies here.
