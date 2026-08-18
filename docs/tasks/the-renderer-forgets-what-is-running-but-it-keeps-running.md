# The renderer forgets what is running, and it goes on running

**Found:** 2026-08-19, when a workspace that was already serving reported "a
server is already running" against its own server.

## What happens

Everything the interface knows about a live script lives in React state:
`useRunSequence` holds the stage, and `Terminal` holds the session id its
cleanup would dispose. The pseudo-terminals themselves live in `main`, in
`TerminalManager`, and outlive any of it.

Reload the renderer and the two disagree. The ptys are still there — the shell,
the dev server, everything under it — while the pane that started them is back
to offering `Run`. Pressing it starts a second server against a port and a pid
file the first one still holds, and the failure names neither.

Reproduced in development, where editing a renderer file is enough: React Fast
Refresh reset `useRunSequence` because `RightPanel.tsx` had changed, while
`Terminal.tsx` had not and its session survived untouched. The header showed
`Run`, the port was busy, and:

```
A server is already running (pid: 18915, file: …/elvira/tmp/pids/server.pid).
```

`ps` showed the shell alive with the Electron main process as its parent — not
an orphan, not a leak, simply a session nobody on screen remembered.

## Why it matters

In development it is a daily nuisance: any edit while a server runs desynchs
them, and the symptom points at the user's script rather than at us.

It is reachable in production too. A renderer that crashes is reloaded, and
every running server then becomes invisible: no `Stop` for it, because the pane
believes nothing is running, and no way to reach it except killing it by hand.
`disposeAll` covers quitting, which is why this is a gap rather than a leak.

## Evidence

- `src/renderer/src/hooks/useRunSequence.ts` — the stage, in `useState`, with
  nothing behind it.
- `src/renderer/src/components/Terminal.tsx` — the session id is a local in the
  mount effect; only its own cleanup can dispose it.
- `src/main/terminals.ts` — `TerminalManager` is the one place that knows what
  exists, and nothing can ask it.
- `src/main/ipc.ts` — `terminal:create/write/resize/dispose`. There is no way to
  ask what is open.

## Sketch

Give the manager a way to answer. A `terminal:list` returning the live session
ids, and enough with each — the workspace and the kind — for the pane to adopt
them on mount rather than start again beside them.

That means a session has to carry what it belongs to. `TerminalSpec` records
`cwd`, `command`, `env`, `cols` and `rows` — enough to _run_ a session and not
enough to _place_ one: the workspace would have to be inferred from a path and
the half from the command, which is the sort of guess that is wrong once and
then wrong quietly. A workspace id and a script kind on the spec would be honest
and cheap.

Worth deciding first, because it changes how much this is worth: whether a run
should survive a renderer reload at all, or whether the simpler answer is for
`main` to dispose every session when the window reloads — the same treatment
quitting already gets. That loses a running server on a crash, which is
annoying; it also makes the state on screen true, which is the property this
note is about.
