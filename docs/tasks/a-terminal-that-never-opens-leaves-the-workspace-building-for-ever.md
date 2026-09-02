# A terminal that never opens leaves the workspace building for ever

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`Terminal` gives up quietly when the session cannot be created: it writes the
error into the xterm canvas and returns. `sessionId` stays null, so `onExit` can
never fire — and `onExit` is the only route to `onOutcome` for the setup half.

`Runner.begin()` has already set `running`/`started` true, so the half sits there
reporting `busy` for a process that does not exist. `useRunSequence.finished` is
the only thing that moves a workspace off `building`, so the stage stays there:
`runAll` is undefined and Run is disabled, `servingAt` is null so no Stop or
Restart is drawn, and `stopRun` is literally `undefined` outside `serving`.

The one visible sign is red text inside the build terminal — **and the build half
is folded on every mount by design**.

The only exits are leaving the project (which unmounts the runner and fires
`onGone` → `abandon`) or restarting the app.

The sibling failures were thought about: a failed `workspaces.prepare` calls
`onOutcome?.(false)` "so a sequence waiting on this half would not wait for
ever", and the unmount case is what `abandon` exists for. The create failure is
the third door and it is unguarded.

**Two triggers this is _not_.** CLAUDE.md names a broken `node-pty` build, but
node-pty runs `loadNativeModule('pty')` at module scope and `terminals.ts`
imports it statically, so a genuinely broken binding stops the main process
loading at all — the app does not start and no `{ ok: false }` reaches the
renderer. And a vanished worktree does not fail create either: on macOS node-pty
chdirs _in the child_ (`spawn-helper.cc:17-19`), so `posix_spawnp` succeeds and
`terminal:exit` arrives with code 1, which routes to stage `failed` correctly.

The reachable variants are narrower: `pty.node` loads but `spawn-helper` is
missing or not executable, pty/process exhaustion (node-pty throws
"posix_spawnp failed."), or a spec zod rejects.

## Why it matters

The header says "Building. The server starts when this finishes." indefinitely,
Run is greyed out, there is no Stop, and the explanation is hidden inside a
collapsed pane. Nothing in the tab can clear it.

Medium rather than high because reaching it needs an already half-broken pty
environment, and leaving the project recovers the state without losing anything.

## Evidence

- `src/renderer/src/components/Terminal.tsx:148-151` — the create failure writes
  to the canvas and returns; `:132-136` — the exit subscriber filters on a
  `sessionId` that stays null.
- `src/renderer/src/components/ScriptRunner.tsx:321-325` — `begin()` sets
  `started`/`running` before the terminal has a session; `:274-281` and `:412-415`
  — the only two routes to `onOutcome` for kind `setup`.
- `src/renderer/src/hooks/useRunSequence.ts:128-142` and `:110-117`.
- `src/renderer/src/components/RightPanel.tsx:258`, `:326-339`, `:373-376`,
  `:682-724`, `:230`, `:919-921`, `:939-942`.
- `src/main/ipc.ts:188` with `src/main/result.ts:36-62` — a spawn throw crosses
  IPC as an ordinary `{ ok: false }`.
- `node_modules/node-pty/src/unix/spawn-helper.cc:17-19` and
  `node_modules/node-pty/lib/utils.js:16-36` — the two refuted triggers.

## What is already decided

No test asserts the stuck state as behaviour, and the authors' own comments —
"a sequence waiting on this half would otherwise wait for ever", "would strand
the workspace with Run disabled and nothing to press" — show this is an oversight.

## Sketch

`Terminal` already distinguishes "the process reported a code" (`onExit`) from
"the session is gone" (`onClosed`); a failed create is a third outcome that
reports neither. `ScriptRunner` would map it to `setRunning(false)` +
`onOutcome?.(false)`, putting the build at stage `failed` where the header
already prints `scripts.buildFailed` in the danger colour — which also unsticks
the server half's identical silence.

**A bare `exitHandler.current?.(null)` is not enough**, because `Terminal` has a
second consumer: `AuthTerminal.tsx:40-52` passes `onExit={setExitCode}` and
renders `settings.signInKilled` for null, so a sign-in whose pty never started
would claim "a signal killed it". A separate `onFailed` prop keeps both callers
honest.

**The same hole exists one layer up for a rejected promise.** The async IIFE at
`Terminal.tsx:138-164` awaits `terminal.create` with no try/catch, so an
`ipcRenderer.invoke` rejection strands the run identically and paints nothing at
all. Any guard should sit around the await, not only inside the `!result.ok`
branch.

See also `the-folded-build-pane-runs-its-log-through-two-columns.md`, found
alongside this.
